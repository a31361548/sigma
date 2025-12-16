import { useEffect } from "react";
import { useSigma } from "@react-sigma/core";
import forceAtlas2 from "graphology-layout-forceatlas2";

interface ForceAtlas2LayoutProps {
  nodeCount: number;
  onLayoutStop?: () => void;
}

export const ForceAtlas2Layout = ({ nodeCount, onLayoutStop }: ForceAtlas2LayoutProps) => {
  const sigma = useSigma();
  const isHugeGraph = nodeCount > 5000;
  const isBigGraph = nodeCount > 2000;

  useEffect(() => {
    if (nodeCount === 0) return;
    try {
      forceAtlas2.assign(sigma.getGraph(), {
        iterations: isHugeGraph ? 200 : isBigGraph ? 150 : 100,
        settings: {
          linLogMode: true,
          outboundAttractionDistribution: true,
          adjustSizes: !isHugeGraph,
          scalingRatio: isHugeGraph ? 150 : isBigGraph ? 80 : 30,
          gravity: isHugeGraph ? 0.002 : 0.05,
          strongGravityMode: false,
          slowDown: 10,
          barnesHutOptimize: isBigGraph,
          barnesHutTheta: 0.8,
          edgeWeightInfluence: 1.5,
        },
      });
      if (onLayoutStop) onLayoutStop();
    } catch (error) {
      console.error("ForceAtlas2 assign failed:", error);
    }
  }, [isBigGraph, isHugeGraph, nodeCount, onLayoutStop, sigma]);

  return null;
};
