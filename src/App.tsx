import { useCallback, useEffect, useRef, useState } from "react";
import "@react-sigma/core/lib/style.css";
import { SigmaCanvas } from "./components/Graph/SigmaCanvas";
import { DataSourceToggle, type DataSourceType } from "./components/Operations/DataSourceToggle";
import { useDiagram } from "./hooks/useDiagram";
import type { IMockGeneratorConfig } from "./interfaces/mock/IMockGenerator";
import type { IGraphData } from "./interfaces/mock/IMockData";

const config: IMockGeneratorConfig = {
  advisorCount: 200,
  clientsPerAdvisor: { min: 3, max: 8 },
  accountsPerClient: { min: 2, max: 5 },
  transactionsPerAccount: 0,
  fixedTransactionsPerAccount: 0,
};

const average = (value: number | { min: number; max: number }): number => {
  if (typeof value === "number") return value;
  return (value.min + value.max) / 2;
};

const estimateMockNodeCount = (cfg: IMockGeneratorConfig): number => {
  const advisors = typeof cfg.advisorCount === "number" ? cfg.advisorCount : average(cfg.advisorCount);
  const clientsPerAdvisor = average(cfg.clientsPerAdvisor);
  const portfoliosPerClient = average(cfg.accountsPerClient);
  const accountsPerPortfolio = 2;
  const clientCount = advisors * clientsPerAdvisor;
  const portfolioCount = clientCount * portfoliosPerClient;
  const accountCount = portfolioCount * accountsPerPortfolio;
  return Math.round(advisors + clientCount + portfolioCount + accountCount);
};

const BIG_GRAPH_NODE_THRESHOLD = 20000;

function App() {
  const [dataSource, setDataSource] = useState<DataSourceType>(() =>
    estimateMockNodeCount(config) >= BIG_GRAPH_NODE_THRESHOLD ? "json" : "mock",
  );
  const [initialData, setInitialData] = useState<IGraphData>({ nodes: [], edges: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dataSourceRef = useRef<DataSourceType>(dataSource);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  const requestData = useCallback((source: DataSourceType) => {
    const worker = workerRef.current;
    if (!worker) return;

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (source === "json") {
      worker.postMessage({ id: requestId, kind: "loadJson", url: "/fakedata.json" });
      return;
    }
    worker.postMessage({ id: requestId, kind: "generate", config });
  }, []);

  useEffect(() => {
    dataSourceRef.current = dataSource;
  }, [dataSource]);

  useEffect(() => {
    const worker = new Worker(new URL("./workers/graphData.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<unknown>) => {
      const payload = event.data;
      if (typeof payload !== "object" || payload === null) return;
      const record = payload as Record<string, unknown>;
      if (typeof record.id !== "number") return;
      if (record.id !== requestIdRef.current) return;

      if (record.ok === true) {
        const data = record.data;
        if (typeof data === "object" && data !== null) {
          setInitialData(data as IGraphData);
          setLoadError(null);
        }
        setIsLoading(false);
        return;
      }

      const error = typeof record.error === "string" ? record.error : "Unknown error";
      setLoadError(error);
      setIsLoading(false);
    };

    requestData(dataSourceRef.current);

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [requestData]);

  useEffect(() => {
    requestData(dataSource);
  }, [dataSource, requestData]);

  const handleDataSourceChange = useCallback(
    (next: DataSourceType) => {
      setIsLoading(true);
      setLoadError(null);

      if (next === "mock") {
        const estimatedNodes = estimateMockNodeCount(config);
        if (estimatedNodes >= BIG_GRAPH_NODE_THRESHOLD) {
          setLoadError(`mock 估算節點數約 ${estimatedNodes}，過大可能造成卡頓，已自動改用 fakedata.json。`);
          setDataSource("json");
          return;
        }
      }

      setDataSource(next);
    },
    [setDataSource],
  );

  const { nodes, edges } = useDiagram(initialData.nodes, initialData.edges);

  if (isLoading) {
    return <div className="app-container">Loading...</div>;
  }

  return (
    <div className="app-container">
      <DataSourceToggle value={dataSource} onChange={handleDataSourceChange} disabled={isLoading} />
      {loadError && <div className="panel" style={{ margin: "12px auto", maxWidth: 900 }}>載入失敗：{loadError}</div>}
      <SigmaCanvas nodes={nodes} edges={edges} />
    </div>
  );
}

export default App;
