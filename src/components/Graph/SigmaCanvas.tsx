import {
  ControlsContainer,
  FullScreenControl,
  SigmaContainer,
  useLoadGraph,
  useRegisterEvents,
  useSigma,
  ZoomControl,
} from "@react-sigma/core";
import Graph from "graphology";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import type { ISigmaEdge, ISigmaNode, NodePayload } from "../../interfaces/mock/IMockData";
import { ForceAtlas2Layout } from "./ForceAtlas2Layout";
import { ElkLayout } from "./ElkLayout";
import { GraphSearch } from "../Operations/GraphSearch";
import drawLabel from "../../utils/sigma/drawLabel";


interface SigmaCanvasProps {
  nodes: ISigmaNode[];
  edges: ISigmaEdge[];
}

const colorMap = {
  advisor: "#ef4444",
  client: "#10b981",
  portfolio: "#f59e0b",
  account: "#8b5cf6",
};

const edgeColorMap = {
  structural: "#e2e8f0",
  transactional: "#64748b",
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type LayoutMode = "force" | "layered" | "radial";

import type Sigma from "sigma";
import { ContextMenu } from "./ContextMenu";

// ... existing imports

/**
 * Layout 調參筆記（只影響「展開」後新顯示的 structural 子節點 x/y，不改 hidden/展開/互動邏輯）
 *
 * 位置：`handleExpandNode`
 *
 * 目的：Structure（layered）模式展開時，避免子節點與父節點（或父節點 label）視覺重疊。
 *
 * layered 模式參數（往父節點右側扇出）：
 * - `minDx`：父→子最小 X 位移（越大越往右、更不容易重疊）
 * - `yStep`：同一批子節點彼此的 Y 基準間距（越大越分散）
 * - Y 位移公式：`yOffset = (index - mid) * (yStep + childSize * 4)`
 *   - `index - mid`：讓子節點以父節點為中心上下對稱分佈；子節點越多，最上/最下的偏移會被放大
 *   - `childSize * 4`：依子節點大小追加的 Y 間距（大節點彼此留更大縫隙），因此 `yStep` 的變化會被成倍放大
 * - X 目標公式：`desiredX = parentX + minDx + childSize * 8`
 *   - `minDx`：保底把子節點推到父節點右側，避免父節點/label 視覺重疊
 *   - `childSize * 8`：依子節點大小再多推一些（大節點推更遠）
 * - `minSeparation`：用來判斷是否需要重排 Y（若子節點離父節點太近才重排 Y；X 推移不受此限制）
 *
 * 非 layered（目前用環狀散開）參數：
 * - `baseRadius`：第一圈半徑（越大越遠離父節點）
 * - `ringGap`：每一圈半徑增量（越大圈與圈距離越大）
 * - `maxPerRing`：每圈最多放幾個子節點（越小越容易長出多圈、但每圈更稀疏）
 */
const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const SigmaCanvas = ({ nodes, edges }: SigmaCanvasProps) => {
  const isBigData = nodes.length > 2000;
  const graph = useMemo(() => buildGraph(nodes, edges, isBigData), [edges, isBigData, nodes]);
  const [hoveredNode, setHoveredNode] = useState<{ node: ISigmaNode; x: number; y: number } | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("force");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  // Fix: Stabilize this callback to prevent ElkLayout from re-running on every render (e.g. hover)
  const handleLayoutStop = useCallback(() => {
    // Layout calculation finished
  }, []);

  const handleHover = useCallback((node: ISigmaNode | null, event?: MouseEvent) => {
    if (!node || !event) {
      setHoveredNode(null);
    } else {
      setHoveredNode({ node, x: event.clientX, y: event.clientY });
    }
  }, []);

  const handleRightClickNode = useCallback((event: any) => {
      event.event.original.preventDefault();
      setContextMenu({
          x: event.event.x,
          y: event.event.y,
          nodeId: event.node
      });
  }, []);

  const closeContextMenu = useCallback(() => {
      setContextMenu(null);
  }, []);

  const handleHideNode = useCallback((nodeId: string) => {
      // Hide structural children (neighbors connected by outgoing structural edges)
      graph.forEachOutEdge(nodeId, (_edge, attributes, _source, target) => {
          if (attributes.edgeType === 'structural') {
              graph.setNodeAttribute(target, "hidden", true);
          }
      });
      // Force refresh to ensure edges are re-evaluated
      if (sigmaRef.current) sigmaRef.current.refresh();
  }, [graph]);

	  const handleExpandNode = useCallback((nodeId: string) => {
	      const newlyRevealed: string[] = [];
	      const structuralChildren: string[] = [];

      // Show structural children
	      graph.forEachOutEdge(nodeId, (_edge, attributes, _source, target) => {
	          if (attributes.edgeType !== "structural") return;
	          const wasHidden = graph.getNodeAttribute(target, "hidden") === true;
	          graph.setNodeAttribute(target, "hidden", false);
	          structuralChildren.push(target);
	          if (wasHidden) newlyRevealed.push(target);
	      });

	      if (structuralChildren.length > 0) {
	        const parentX = readNumber(graph.getNodeAttribute(nodeId, "x")) ?? 0;
	        const parentY = readNumber(graph.getNodeAttribute(nodeId, "y")) ?? 0;
	        const parentSize = readNumber(graph.getNodeAttribute(nodeId, "size")) ?? 10;

	        const minSeparation = Math.max(120, parentSize * 12 );

        const shouldReposition = (childId: string): boolean => {
          const childX = readNumber(graph.getNodeAttribute(childId, "x"));
          const childY = readNumber(graph.getNodeAttribute(childId, "y"));
          if (childX === null || childY === null) return true;
          const dx = childX - parentX;
          const dy = childY - parentY;
          return Math.sqrt(dx * dx + dy * dy) < minSeparation;
        };

	        if (layoutMode === "layered") {
	          const candidates = structuralChildren.filter(
	            (childId) => graph.getNodeAttribute(childId, "hidden") !== true,
	          );

	          candidates.sort((a, b) => {
	            const ay = readNumber(graph.getNodeAttribute(a, "y")) ?? 0;
	            const by = readNumber(graph.getNodeAttribute(b, "y")) ?? 0;
	            return ay - by;
	          });

	          const minDx = Math.max(520, parentSize * 24);
	          const yStep = 150;
	          const mid = (candidates.length - 1) / 2;

	          candidates.forEach((childId, index) => {
	            const childSize = readNumber(graph.getNodeAttribute(childId, "size")) ?? 8;
	            const desiredX = parentX + minDx + childSize * 8;

	            const childX = readNumber(graph.getNodeAttribute(childId, "x"));
	            const childY = readNumber(graph.getNodeAttribute(childId, "y"));

	            if (childX === null || childX < desiredX) {
	              graph.setNodeAttribute(childId, "x", desiredX);
	            }

	            if (childY === null || shouldReposition(childId)) {
	              const yOffset = (index - mid) * (yStep + childSize * 4);
	              graph.setNodeAttribute(childId, "y", parentY + yOffset);
	            }
	          });
	        } else {
	          const maxPerRing = 12;
	          const ringGap = 140;
	          const baseRadius = Math.max(140, parentSize * 14);

	          newlyRevealed.forEach((childId, index) => {
            if (!shouldReposition(childId)) return;
            const ringIndex = Math.floor(index / maxPerRing);
            const indexInRing = index % maxPerRing;
            const countInRing = Math.min(maxPerRing, newlyRevealed.length - ringIndex * maxPerRing);
            const angle = (indexInRing / Math.max(1, countInRing)) * Math.PI * 2;

          const childSize = readNumber(graph.getNodeAttribute(childId, "size")) ?? 8;
          const ringRadius = baseRadius + ringIndex * ringGap + childSize * 6;

          graph.setNodeAttribute(childId, "x", parentX + Math.cos(angle) * ringRadius);
          graph.setNodeAttribute(childId, "y", parentY + Math.sin(angle) * ringRadius);
          });
        }
      }

      // Force refresh to ensure edges are re-evaluated
      if (sigmaRef.current) sigmaRef.current.refresh();
  }, [graph, layoutMode]);

  const settings = useMemo(() => ({
    renderEdgeLabels: false,
    minCameraRatio: 0.1,
    maxCameraRatio: 500,
    labelDensity: 0.07,
    labelRenderedSizeThreshold: 0, // Force show all labels
    // @ts-ignore: Sigma v3 supports labelRenderer but type might be missing in @react-sigma settings
    labelRenderer: drawLabel,
    nodeReducer: (_node: string, data: any) => {
      if (data.hidden) {
        return { ...data, size: 0, label: "" };
      }
      return data;
    },
    edgeReducer: (edge: string, data: any) => {
       // Use captured 'graph' instance from closure
       // Safety check
       if (!graph.hasEdge(edge)) return data;

       // Retrieve endpoints from graph because 'data' only contains display attributes
       const source = graph.source(edge);
       const target = graph.target(edge);
       
       // Check visibility of endpoints
       const sourceHidden = graph.getNodeAttribute(source, "hidden");
       const targetHidden = graph.getNodeAttribute(target, "hidden");
       
       if (sourceHidden || targetHidden) {
           return { ...data, hidden: true, size: 0 };
       }
       return data;
    }
  }), [graph]);

  return (
    <div className="graph-container" onClick={closeContextMenu}>
      <SigmaContainer
        style={{ width: "100%", height: "100%" }}
        settings={settings}
      >
        <GraphEvents
          graph={graph}
          onHoverChange={handleHover}
          onRightClickNode={handleRightClickNode}
          setSigma={(s) => { sigmaRef.current = s; }}
        />
        
        <GraphSearch />

        {contextMenu && (
            <ContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                nodeId={contextMenu.nodeId}
                onClose={closeContextMenu}
                onHide={handleHideNode}
                onExpand={handleExpandNode}
            />
        )}
{/* ... existing layouts */}

        {layoutMode === "force" && (
          <ForceAtlas2Layout nodeCount={nodes.length} />
        )}
        
        {(layoutMode === "layered" || layoutMode === "radial") && (
          <ElkLayout 
            layoutType={layoutMode} 
            isLayoutActive={true} 
            onLayoutStop={handleLayoutStop}
          />
        )}

        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 10, display: "flex", gap: "8px" }}>
            <button 
              onClick={() => setLayoutMode("force")}
              style={{ padding: "6px 12px", background: layoutMode === "force" ? "#333" : "#fff", color: layoutMode === "force" ? "#fff" : "#333", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}
            >
              Force
            </button>
            <button 
              onClick={() => setLayoutMode("layered")}
              style={{ padding: "6px 12px", background: layoutMode === "layered" ? "#333" : "#fff", color: layoutMode === "layered" ? "#fff" : "#333", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}
            >
              Structure (Layered)
            </button>
        </div>

        <ControlsContainer position="bottom-right">
          <ZoomControl />
          <FullScreenControl />
        </ControlsContainer>
      </SigmaContainer>
      {hoveredNode && (
        <div className="graph-tooltip" style={{ top: hoveredNode.y + 8, left: hoveredNode.x + 8 }}>
          {hoveredNode.node.label}
        </div>
      )}
    </div>
  );
};

interface GraphEventsProps {
  graph: Graph;
  onHoverChange: (node: ISigmaNode | null, event?: MouseEvent) => void;
  onRightClickNode?: (event: any) => void;
  setSigma?: (sigma: Sigma) => void;
}

const GraphEvents = ({ graph, onHoverChange, onRightClickNode, setSigma }: GraphEventsProps) => {
  const loadGraph = useLoadGraph();
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();
  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
      if (setSigma) setSigma(sigma);
  }, [sigma, setSigma]);

  useEffect(() => {
    loadGraph(graph);
  }, [graph, loadGraph]);
  
  // Force apply labelRenderer setting directly to sigma instance
  // This bypasses potential filtering by SigmaContainer props
  useEffect(() => {
    // Force set all possible label rendering settings to our custom function
    const rendererSettings = {
        labelRenderer: drawLabel,
        hoverRenderer: drawLabel,
        defaultDrawNodeLabel: drawLabel,
        defaultDrawNodeHover: drawLabel
    };
    
    Object.entries(rendererSettings).forEach(([key, value]) => {
        sigma.setSetting(key as any, value);
    });
    
  }, [sigma]);

  useEffect(() => {
    const container = sigma.getContainer();
    if (!container) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging || !draggedNode) return;
      const pos = sigma.viewportToGraph({ x: event.clientX, y: event.clientY });
      sigma.getGraph().setNodeAttribute(draggedNode, "x", pos.x);
      sigma.getGraph().setNodeAttribute(draggedNode, "y", pos.y);
      event.preventDefault();
      event.stopPropagation();
    };

    const stopDragging = () => {
      if (!isDragging) return;
      setIsDragging(false);
      setDraggedNode(null);
      sigma.getCamera().enable();
    };

    const handleContextMenu = (e: Event) => {
       e.preventDefault(); // Prevent native context menu on canvas
    };

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseup", stopDragging);
    container.addEventListener("mouseleave", stopDragging);
    container.addEventListener("contextmenu", handleContextMenu);

    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseup", stopDragging);
      container.removeEventListener("mouseleave", stopDragging);
      container.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [draggedNode, isDragging, sigma]);

  useEffect(() => {
    const stopDragging = () => {
      if (!draggedNode && !isDragging) return;
      if (draggedNode) {
        sigma.getGraph().removeNodeAttribute(draggedNode, "highlighted");
      }
      setIsDragging(false);
      setDraggedNode(null);
      sigma.getCamera().enable();
    };

    registerEvents({
      downNode(e) {
        // Only drag on left click (or if checks are generic, fine. usually downNode is left)
        setDraggedNode(e.node);
        setIsDragging(true);
        sigma.getGraph().setNodeAttribute(e.node, "highlighted", true);
        sigma.getCamera().disable();
      },
      rightClickNode(e) {
          if (onRightClickNode) onRightClickNode(e);
      },
      upNode: stopDragging,
      downStage: stopDragging,
      leaveNode: () => onHoverChange(null),
      enterNode: (event) => {
        const payload = graph.getNodeAttribute(event.node, "payload") as ISigmaNode | undefined;
        const mouse = event.event.original as MouseEvent;
        if (payload && mouse) {
          onHoverChange(payload, mouse);
        }
      },
    });
  }, [draggedNode, graph, isDragging, onHoverChange, registerEvents, sigma, onRightClickNode]);

  return null;
};

const buildGraph = (nodes: ISigmaNode[], edges: ISigmaEdge[], isBigData: boolean) => {
  const graph = new Graph({ type: "directed", multi: true });
  const initialSpread = clamp(nodes.length * 20, 2000, 40000);

  nodes.forEach((node, index) => {
    const angle = ((index / Math.max(1, nodes.length)) * Math.PI * 2 * 13) % (Math.PI * 2);
    const radius = Math.sqrt(Math.random()) * initialSpread;
    const payload = node.data as NodePayload | undefined;
    const type = payload?.metaData?.businessType;
    let color = colorMap.account;
    let size = isBigData ? 4 : 8;
    
    // Initial Visibility Logic:
    // Advisors (理專) are visible. All other nodes hidden.
    const isAdvisor = type === "理專";

    if (type === "理專") {
      color = colorMap.advisor;
      size = isBigData ? 12 : 16;
    } else if (type === "客戶") {
      color = colorMap.client;
      size = isBigData ? 6 : 12;
    } else if (type === "投資組合") {
      color = colorMap.portfolio;
      size = isBigData ? 5 : 10;
    }

    graph.mergeNode(node.id, {
      label: node.label,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      size,
      color,
      payload: node,
      hidden: !isAdvisor, // Initially hide if not advisor
    });
  });

  edges.forEach((edge) => {
    const isTrans = edge.data?.type === "transactional";
    const color = isTrans ? edgeColorMap.transactional : edgeColorMap.structural;
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
    if (graph.hasEdge(edge.id) || graph.hasDirectedEdge(edge.source, edge.target)) return;
    try {
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
        color,
        size: isTrans ? 3 : 1,
        label: edge.label,
        type: "arrow",
        weight: isTrans ? 10 : 0.05,
        zIndex: isTrans ? 10 : 0,
        edgeType: edge.data?.type || "structural",
      });
    } catch (error) {
      // Edge already exists; ignore
    }
  });

  return graph;
};
