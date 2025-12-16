import { useEffect, useRef } from "react";
import { useSigma } from "@react-sigma/core";
import ELK from "elkjs/lib/elk.bundled";
import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk.bundled";

interface ElkLayoutProps {
  layoutType?: "layered" | "radial" | "mrtree" | "force";
  onLayoutStop?: () => void;
  isLayoutActive: boolean;
}

const elk = new ELK();

export const ElkLayout = ({ layoutType = "layered", onLayoutStop, isLayoutActive }: ElkLayoutProps) => {
  const sigma = useSigma();
  const graph = sigma.getGraph();
  const layoutRunning = useRef(false);

  useEffect(() => {
    if (!isLayoutActive || graph.order === 0 || layoutRunning.current) return;

    layoutRunning.current = true;

    // 1. Convert Graphology data to ELK JSON format
    const elkNodes: ElkNode[] = graph.mapNodes((node, attributes) => ({
      id: node,
      // "Label-First" Sizing strategy
      // Diameter + 150px fixed buffer for text labels.
      // This ensures even small nodes reserve space for their text.
      width: (attributes.size || 10) * 2 + 150, 
      height: (attributes.size || 10) * 2 + 20,
    }));

    const elkEdges: ElkExtendedEdge[] = graph.mapEdges((edge, _attr, source, target) => ({
      id: edge,
      sources: [source],
      targets: [target],
    }));

    // 2. Configure ELK algorithm parameters
    const layoutOptions: { [key: string]: string } = {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT", 
      
      "elk.separateConnectedComponents": "true",
      "elk.spacing.componentComponent": "250", 

      // Internal Spacing (Micro Structure)
      "elk.spacing.nodeNode": "150", 
      "elk.layered.spacing.layerNodeBetweenLayers": "350", 
      "elk.spacing.edgeNode": "60",
    };

    const graphPayload: ElkNode = {
      id: "root",
      layoutOptions: layoutOptions,
      children: elkNodes,
      edges: elkEdges,
    };

    // 3. Execute ELK layout
    elk.layout(graphPayload)
      .then((layoutedGraph) => {
        // 4. Update Graphology with calculated coordinates
        layoutedGraph.children?.forEach((node) => {
          if (node.x !== undefined && node.y !== undefined) {
             // Animate or set directly. 
             // Using simple setAttribute here, but could use graph.updateEachNodeAttributes for efficiency in v2
             // In Sigma v3 / Graphology, setNodeAttribute is fine.
             // We adjust for ELK's top-left origin vs Sigma's center origin if needed, 
             // but Sigma auto-centers usually.
            graph.setNodeAttribute(node.id, "x", node.x);
            graph.setNodeAttribute(node.id, "y", node.y);
          }
        });
        
        if (onLayoutStop) onLayoutStop();
      })
      .catch((err) => {
        console.error("ELK Layout Error:", err);
      })
      .finally(() => {
        layoutRunning.current = false;
      });

  }, [graph, layoutType, onLayoutStop, sigma, isLayoutActive]);

  return null;
};
