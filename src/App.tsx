import { useEffect, useState } from "react";
import "@react-sigma/core/lib/style.css";
import { SigmaCanvas } from "./components/Graph/SigmaCanvas";
import { DataSourceToggle, type DataSourceType } from "./components/Operations/DataSourceToggle";
import { MockDataGenerator } from "./services/MockDataGenerator";
import { useDiagram } from "./hooks/useDiagram";
import type { IMockGeneratorConfig } from "./interfaces/mock/IMockGenerator";
import type { IGraphData, ISigmaNode } from "./interfaces/mock/IMockData";

const config: IMockGeneratorConfig = {
  advisorCount: 50,
  clientsPerAdvisor: { min: 3, max: 8 },
  accountsPerClient: { min: 2, max: 5 },
  transactionsPerAccount: 0,
  fixedTransactionsPerAccount: 0,
};

function App() {
  const [dataSource, setDataSource] = useState<DataSourceType>("mock");
  const [initialData, setInitialData] = useState<IGraphData>({ nodes: [], edges: [] });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        if (dataSource === "json") {
          // 暫時取消對 fakedata.json 的引用
          /*
          const response = await fetch("/fakedata.json");
          if (!response.ok) throw new Error("fakedata.json not found");
          const data = (await response.json()) as IGraphData;
          if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
            throw new Error("Invalid data format");
          }
          const strippedNodes = data.nodes.map((node) => {
            const clone = node as ISigmaNode;
            delete (clone as Partial<ISigmaNode>).x;
            delete (clone as Partial<ISigmaNode>).y;
            return clone;
          });
          setInitialData({ nodes: strippedNodes, edges: data.edges });
          */
           console.warn("JSON mode is temporarily disabled. Switching to mock data.");
           const generator = new MockDataGenerator(config);
           setInitialData(generator.generateGraphData());
        } else {
          const generator = new MockDataGenerator(config);
          setInitialData(generator.generateGraphData());
        }
      } catch (error) {
        console.warn("載入資料失敗，改用內建假資料。", error);
        const generator = new MockDataGenerator(config);
        setInitialData(generator.generateGraphData());
      } finally {
        setIsLoading(false);
      }
    };
    void loadData();
  }, [dataSource]);

  const { nodes, edges } = useDiagram(initialData.nodes, initialData.edges);

  if (isLoading) {
    return <div className="app-container">Loading...</div>;
  }

  return (
    <div className="app-container">
      <DataSourceToggle value={dataSource} onChange={setDataSource} disabled={isLoading} />
      <SigmaCanvas nodes={nodes} edges={edges} />
    </div>
  );
}

export default App;
