import { MockDataGenerator } from "../services/MockDataGenerator";
import type { IMockGeneratorConfig } from "../interfaces/mock/IMockGenerator";
import type { IGraphData, ISigmaNode } from "../interfaces/mock/IMockData";

type RequestId = number;

type GenerateRequest = {
  id: RequestId;
  kind: "generate";
  config: IMockGeneratorConfig;
};

type LoadJsonRequest = {
  id: RequestId;
  kind: "loadJson";
  url: string;
};

type WorkerRequest = GenerateRequest | LoadJsonRequest;

type WorkerSuccess = { id: RequestId; ok: true; data: IGraphData };
type WorkerFailure = { id: RequestId; ok: false; error: string };
type WorkerResponse = WorkerSuccess | WorkerFailure;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isGraphData = (value: unknown): value is IGraphData => {
  if (!isRecord(value)) return false;
  return Array.isArray(value.nodes) && Array.isArray(value.edges);
};

const stripXY = (nodes: ReadonlyArray<ISigmaNode>): ISigmaNode[] =>
  nodes.map((node) => {
    const clone: ISigmaNode = { ...node };
    delete (clone as Partial<ISigmaNode>).x;
    delete (clone as Partial<ISigmaNode>).y;
    return clone;
  });

const post = (message: WorkerResponse): void => {
  self.postMessage(message);
};

self.onmessage = (event: MessageEvent<unknown>) => {
  const payload = event.data;
  if (!isRecord(payload)) return;
  if (typeof payload.id !== "number") return;
  if (typeof payload.kind !== "string") return;

  const id = payload.id as RequestId;

  void (async () => {
    try {
      if (payload.kind === "generate") {
        const config = payload.config;
        const generator = new MockDataGenerator(config as IMockGeneratorConfig);
        const data = generator.generateGraphData();
        post({ id, ok: true, data: { nodes: stripXY(data.nodes), edges: data.edges } });
        return;
      }

      if (payload.kind === "loadJson") {
        const url = payload.url;
        if (typeof url !== "string" || url.length === 0) {
          post({ id, ok: false, error: "Invalid url" });
          return;
        }
        const response = await fetch(url);
        if (!response.ok) {
          post({ id, ok: false, error: `Fetch failed: ${response.status}` });
          return;
        }
        const text = await response.text();
        const parsed: unknown = JSON.parse(text);
        if (!isGraphData(parsed)) {
          post({ id, ok: false, error: "Invalid data format" });
          return;
        }
        const graph = parsed as IGraphData;
        post({ id, ok: true, data: { nodes: stripXY(graph.nodes as ISigmaNode[]), edges: graph.edges } });
        return;
      }

      post({ id, ok: false, error: `Unknown kind: ${String(payload.kind)}` });
    } catch (err) {
      post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
};

