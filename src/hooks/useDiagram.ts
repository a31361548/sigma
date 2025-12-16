import { useEffect, useState } from "react";
import type { ISigmaEdge, ISigmaNode } from "../interfaces/mock/IMockData";

const withSeededPosition = (nodes: ISigmaNode[]): ISigmaNode[] =>
  nodes.map((node, index) => {
    if (typeof node.x === "number" && typeof node.y === "number") return node;
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
    const radius = 200 + index * 3;
    return { ...node, x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });

export const useDiagram = (initialNodes: ISigmaNode[], initialEdges: ISigmaEdge[]) => {
  const [nodes, setNodes] = useState<ISigmaNode[]>(withSeededPosition(initialNodes));
  const [edges, setEdges] = useState<ISigmaEdge[]>(initialEdges);

  useEffect(() => {
    setNodes(withSeededPosition(initialNodes));
    setEdges(initialEdges);
  }, [initialEdges, initialNodes]);

  return {
    nodes,
    edges,
    setAllNodes: (next: ISigmaNode[]) => setNodes(withSeededPosition(next)),
    setAllEdges: setEdges,
  };
};
