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
import { ElkLayout } from "./ElkLayout";
import { GraphSearch } from "../Operations/GraphSearch";
import drawLabel from "../../utils/sigma/drawLabel";
import { drawStraightEdgeLabel } from "sigma/rendering";
import EdgeCurveProgram from "@sigma/edge-curve";
import { createNodeImageProgram } from "@sigma/node-image";
import { downloadAsPNG } from "@sigma/export-image";


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

const iconMapByBusinessType: Record<string, string> = {
  理專: "/image/gangs.png",
  客戶: "/image/person.png",
  帳號: "/image/accounts.png",
};

const edgeColorMap = {
  structural: "#e2e8f0",
  transactional: "#64748b",
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Edge label 顯示規則：hover 一定顯示；沒 hover 時則在鏡頭夠近才顯示（ratio 越小代表越 zoom-in）
const EDGE_LABEL_SHOW_MAX_CAMERA_RATIO = 1.8;
const HOVER_FOCUS_APPLY_DELAY_MS = 60;
const HOVER_FOCUS_CLEAR_DELAY_MS = 120;

type LayoutMode = "layered" | "radial";
type ExpandMode = "structure" | "circle";

import type Sigma from "sigma";
import { ContextMenu } from "./ContextMenu";
import { NodeDetailPanel } from "./NodeDetailPanel";

type EdgeType = "structural" | "transactional" | null;

class MultiDirectedGraph extends Graph {
  constructor() {
    super({ type: "directed", multi: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readEdgeType(attributes: unknown): EdgeType {
  if (!isRecord(attributes)) return null;
  const edgeType = attributes.edgeType;
  if (edgeType === "structural" || edgeType === "transactional") return edgeType;
  return null;
}

function isPinned(value: unknown): boolean {
  return value === true;
}

function relayoutVisibleStructuralNodes(input: {
  graph: Graph;
  expandMode: ExpandMode;
  layoutMode: LayoutMode;
}): void {
  const { graph, expandMode, layoutMode } = input;

  const visibleNodes: string[] = [];
  graph.forEachNode((nodeId, attributes) => {
    const hidden = isRecord(attributes) ? attributes.hidden : undefined;
    if (hidden !== true) visibleNodes.push(nodeId);
  });
  const visibleSet = new Set(visibleNodes);

  const advisorRoots: string[] = [];
  visibleNodes.forEach((nodeId) => {
    const payload = graph.getNodeAttribute(nodeId, "payload");
    const maybeBusinessType =
      isRecord(payload) && isRecord(payload.data) && isRecord(payload.data.metaData)
        ? payload.data.metaData.businessType
        : null;
    if (maybeBusinessType === "理專") advisorRoots.push(nodeId);
  });

  const roots =
    advisorRoots.length > 0
      ? advisorRoots
      : visibleNodes.filter((nodeId) => {
          let hasVisibleStructuralParent = false;
          graph.forEachInEdge(nodeId, (_edge, attributes, source) => {
            if (hasVisibleStructuralParent) return;
            if (readEdgeType(attributes) !== "structural") return;
            if (visibleSet.has(source)) hasVisibleStructuralParent = true;
          });
          return !hasVisibleStructuralParent;
        });

  roots.sort();

  const visited = new Set<string>();
  const queue: string[] = [...roots];

  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId) break;
    if (visited.has(parentId)) continue;
    visited.add(parentId);

    const parentX = readNumber(graph.getNodeAttribute(parentId, "x")) ?? 0;
    const parentY = readNumber(graph.getNodeAttribute(parentId, "y")) ?? 0;
    const parentSize = readNumber(graph.getNodeAttribute(parentId, "size")) ?? 10;

    const visibleStructuralChildren: string[] = [];
    graph.forEachOutEdge(parentId, (_edge, attributes, _source, target) => {
      if (readEdgeType(attributes) !== "structural") return;
      if (!visibleSet.has(target)) return;
      visibleStructuralChildren.push(target);
    });

    visibleStructuralChildren.forEach((childId) => {
      if (!visited.has(childId)) queue.push(childId);
    });

    const movableChildren = visibleStructuralChildren.filter(
      (childId) => !isPinned(graph.getNodeAttribute(childId, "pinned")),
    );

    if (movableChildren.length === 0) continue;

    if (expandMode === "circle") {
      const sortedChildren = [...movableChildren].sort();
      const childSizes = sortedChildren.map((childId) => readNumber(graph.getNodeAttribute(childId, "size")) ?? 8);
      const avgChildSize = childSizes.reduce((sum, n) => sum + n, 0) / Math.max(1, childSizes.length);
      const baseRadius = Math.max(300, parentSize * 28);
      const densityBoost = Math.sqrt(sortedChildren.length) * 130;
      const rawRadius = baseRadius + densityBoost + avgChildSize * 6;
      const radius = clamp(rawRadius, 180, 6000);

      sortedChildren.forEach((childId, index) => {
        const n = sortedChildren.length;
        const angle = (index / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
        const childSize = readNumber(graph.getNodeAttribute(childId, "size")) ?? 8;
        const r = radius + childSize * 8;
        graph.setNodeAttribute(childId, "x", parentX + Math.cos(angle) * r);
        graph.setNodeAttribute(childId, "y", parentY + Math.sin(angle) * r);
      });
      continue;
    }

    if (layoutMode === "layered") {
      const candidates = [...movableChildren].sort((a, b) => {
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
        const yOffset = (index - mid) * (yStep + childSize * 4);
        graph.setNodeAttribute(childId, "x", desiredX);
        graph.setNodeAttribute(childId, "y", parentY + yOffset);
      });
      continue;
    }

    const maxPerRing = 12;
    const ringGap = 140;
    const baseRadius = Math.max(140, parentSize * 14);
    const sortedChildren = [...movableChildren].sort();

    sortedChildren.forEach((childId, index) => {
      const ringIndex = Math.floor(index / maxPerRing);
      const indexInRing = index % maxPerRing;
      const countInRing = Math.min(maxPerRing, sortedChildren.length - ringIndex * maxPerRing);
      const angle = (indexInRing / Math.max(1, countInRing)) * Math.PI * 2;
      const childSize = readNumber(graph.getNodeAttribute(childId, "size")) ?? 8;
      const ringRadius = baseRadius + ringIndex * ringGap + childSize * 6;
      graph.setNodeAttribute(childId, "x", parentX + Math.cos(angle) * ringRadius);
      graph.setNodeAttribute(childId, "y", parentY + Math.sin(angle) * ringRadius);
    });
  }
}

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
  const hoveredEdgeIdRef = useRef<string | null>(null);
  const hoverFocusRef = useRef<{ nodeId: string; relatedNodes: Set<string> } | null>(null);
  const hoverFocusTimersRef = useRef<{ applyTimer: number | null; clearTimer: number | null }>({
    applyTimer: null,
    clearTimer: null,
  });
  const [layoutMode] = useState<LayoutMode>("layered");
  const [expandMode, setExpandMode] = useState<ExpandMode>("structure");
  const [isInitialLayoutReady, setIsInitialLayoutReady] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  // Fix: Stabilize this callback to prevent ElkLayout from re-running on every render (e.g. hover)
  const handleLayoutStop = useCallback(() => {
    setIsInitialLayoutReady(true);
    if (sigmaRef.current) sigmaRef.current.refresh();
  }, []);

  useEffect(() => {
    setIsInitialLayoutReady(false);
  }, [graph]);

  useEffect(() => {
    if (!isInitialLayoutReady) return;
    if (!sigmaRef.current) return;
    relayoutVisibleStructuralNodes({ graph, expandMode, layoutMode });
    sigmaRef.current.refresh();
  }, [expandMode, graph, isInitialLayoutReady, layoutMode]);

  const computeRelatedNodes = useCallback(
    (startNodeId: string, maxHops: number): Set<string> => {
      const related = new Set<string>([startNodeId]);
      let frontier: string[] = [startNodeId];

      for (let depth = 0; depth < maxHops; depth += 1) {
        const nextFrontier: string[] = [];
        frontier.forEach((nodeId) => {
          graph.forEachNeighbor(nodeId, (neighborId) => {
            if (related.has(neighborId)) return;
            related.add(neighborId);
            nextFrontier.push(neighborId);
          });
        });
        frontier = nextFrontier;
        if (frontier.length === 0) break;
      }

      return related;
    },
    [graph],
  );

  const handleHover = useCallback((node: ISigmaNode | null, event?: MouseEvent) => {
    const timers = hoverFocusTimersRef.current;
    if (timers.clearTimer !== null) {
      window.clearTimeout(timers.clearTimer);
      timers.clearTimer = null;
    }

    if (!node || !event) {
      setHoveredNode(null);

      if (timers.applyTimer !== null) {
        window.clearTimeout(timers.applyTimer);
        timers.applyTimer = null;
      }

      timers.clearTimer = window.setTimeout(() => {
        hoverFocusRef.current = null;
        if (sigmaRef.current) sigmaRef.current.refresh();
      }, HOVER_FOCUS_CLEAR_DELAY_MS);

      return;
    }

    setHoveredNode({ node, x: event.clientX, y: event.clientY });

    const currentFocus = hoverFocusRef.current;
    if (currentFocus?.nodeId === node.id) return;

    if (timers.applyTimer !== null) {
      window.clearTimeout(timers.applyTimer);
      timers.applyTimer = null;
    }

    const targetNodeId = node.id;
    timers.applyTimer = window.setTimeout(() => {
      hoverFocusRef.current = { nodeId: targetNodeId, relatedNodes: computeRelatedNodes(targetNodeId, 2) };
      if (sigmaRef.current) sigmaRef.current.refresh();
    }, HOVER_FOCUS_APPLY_DELAY_MS);
  }, [computeRelatedNodes]);

  const handleEdgeHoverChange = useCallback((edgeId: string | null) => {
    hoveredEdgeIdRef.current = edgeId;
    if (sigmaRef.current) sigmaRef.current.refresh();
  }, []);

  const handleExportImage = useCallback(() => {
    if (!sigmaRef.current) return;
    downloadAsPNG(sigmaRef.current, { fileName: "graph", backgroundColor: "#ffffff" });
  }, []);

	  useEffect(() => {
	    if (sigmaRef.current) sigmaRef.current.refresh();
	  }, [layoutMode]);

  type SigmaRightClickNodeEvent = { node: string; event: { x: number; y: number; original: Event } };
  const isSigmaRightClickNodeEvent = (value: unknown): value is SigmaRightClickNodeEvent => {
    if (!isRecord(value)) return false;
    if (typeof value.node !== "string") return false;
    if (!isRecord(value.event)) return false;
    return typeof value.event.x === "number" && typeof value.event.y === "number" && "original" in value.event;
  };

  const handleRightClickNode = useCallback((event: unknown) => {
    if (!isSigmaRightClickNodeEvent(event)) return;
    if (typeof event.event.original.preventDefault === "function") {
      event.event.original.preventDefault();
    }
    setContextMenu({ x: event.event.x, y: event.event.y, nodeId: event.node });
  }, []);

  const closeContextMenu = useCallback(() => {
      setContextMenu(null);
  }, []);

  const closeDetailPanel = useCallback(() => {
    setDetailNodeId(null);
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

	        if (expandMode === "circle" && newlyRevealed.length > 0) {
	          const childSizes = newlyRevealed.map(
	            (childId) => readNumber(graph.getNodeAttribute(childId, "size")) ?? 8,
	          );
	          const avgChildSize = childSizes.reduce((sum, n) => sum + n, 0) / Math.max(1, childSizes.length);
	          const baseRadius = Math.max(300, parentSize * 28);
	          const densityBoost = Math.sqrt(newlyRevealed.length) * 130;
	          const radius = baseRadius + densityBoost + avgChildSize * 6;

	          newlyRevealed.forEach((childId, index) => {
	            const n = newlyRevealed.length;
	            const angle = (index / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
	            const childSize = readNumber(graph.getNodeAttribute(childId, "size")) ?? 8;
	            const r = radius + childSize * 8;
	            graph.setNodeAttribute(childId, "x", parentX + Math.cos(angle) * r);
	            graph.setNodeAttribute(childId, "y", parentY + Math.sin(angle) * r);
	          });
	        } else if (layoutMode === "layered") {
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
	  }, [expandMode, graph, layoutMode]);

  const settings = useMemo(() => ({
    renderEdgeLabels: true,
    enableEdgeEvents: true,
    minCameraRatio: 0.1,
    maxCameraRatio: 500,
    labelDensity: 0.07,
    labelRenderedSizeThreshold: 0, // Force show all labels
    labelColor: { color: "#000000" },
    edgeLabelColor: { color: "#000000" },
    defaultDrawEdgeLabel: drawStraightEdgeLabel,
    // @ts-ignore: Sigma v3 supports labelRenderer but type might be missing in @react-sigma settings
    labelRenderer: drawLabel,
    nodeProgramClasses: { image: createNodeImageProgram() },
    edgeProgramClasses: { curved: EdgeCurveProgram },
    defaultEdgeType: "arrow",
    nodeReducer: (nodeId: string, data: Record<string, unknown>) => {
      if (data.hidden === true) return { ...data, size: 0, label: "" };

      const focus = hoverFocusRef.current;
      if (focus && !focus.relatedNodes.has(nodeId)) {
        return { ...data, type: undefined, image: undefined, label: "", color: "#cbd5e1" };
      }

      return data;
    },
    edgeReducer: (edge: string, data: Record<string, unknown>) => {
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

       const focus = hoverFocusRef.current;
       const isRelatedEdge = focus ? focus.relatedNodes.has(source) && focus.relatedNodes.has(target) : true;
       if (!isRelatedEdge) {
         const nextSize = typeof data.size === "number" && Number.isFinite(data.size) ? Math.max(0.4, data.size * 0.5) : data.size;
         return { ...data, color: "#cbd5e1", size: nextSize, label: "" };
       }

       const cameraRatio = sigmaRef.current?.getCamera().getState().ratio;
       const isZoomClose =
         typeof cameraRatio === "number" && cameraRatio <= EDGE_LABEL_SHOW_MAX_CAMERA_RATIO;
       const labelText = typeof data.label === "string" ? data.label : "";
       const isParallelDemoEdge = labelText.startsWith("平行交易");
       const shouldShowLabel = isParallelDemoEdge || isZoomClose || hoveredEdgeIdRef.current === edge;
       if (!shouldShowLabel) return { ...data, label: "" };

       return data;
    }
  }), [graph]);

  return (
    <div className="graph-container" onClick={closeContextMenu}>
      <SigmaContainer
        graph={MultiDirectedGraph}
        style={{
          width: "100%",
          height: "100%",
          opacity: isInitialLayoutReady ? 1 : 0,
          transition: "opacity 120ms ease",
          pointerEvents: isInitialLayoutReady ? "auto" : "none",
        }}
        settings={settings}
      >
        <GraphEvents
          graph={graph}
          onHoverChange={handleHover}
          onEdgeHoverChange={handleEdgeHoverChange}
          onRightClickNode={handleRightClickNode}
          setSigma={(s) => {
            sigmaRef.current = s;
          }}
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
                onShowDetails={(id) => setDetailNodeId(id)}
            />
        )}
{/* ... existing layouts */}

        {(layoutMode === "layered" || layoutMode === "radial") && (
          <ElkLayout 
            layoutType={layoutMode} 
            isLayoutActive={true} 
            onLayoutStop={handleLayoutStop}
          />
        )}

        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 40, display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setExpandMode("structure")}
            style={{
              padding: "6px 12px",
              background: expandMode === "structure" ? "#111827" : "rgba(255,255,255,0.85)",
              color: expandMode === "structure" ? "#fff" : "#111827",
              border: "1px solid rgba(0,0,0,0.18)",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Structure
          </button>
          <button
            type="button"
            onClick={() => setExpandMode("circle")}
            style={{
              padding: "6px 12px",
              background: expandMode === "circle" ? "#111827" : "rgba(255,255,255,0.85)",
              color: expandMode === "circle" ? "#fff" : "#111827",
              border: "1px solid rgba(0,0,0,0.18)",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Circle
          </button>
          <button
            type="button"
            onClick={handleExportImage}
            style={{
              padding: "6px 12px",
              background: "rgba(255,255,255,0.85)",
              color: "#111827",
              border: "1px solid rgba(0,0,0,0.18)",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            匯出圖片
          </button>
        </div>

        <ControlsContainer position="bottom-right">
          <ZoomControl />
          <FullScreenControl />
        </ControlsContainer>
      </SigmaContainer>
      {detailNodeId && (
        <NodeDetailPanel
          title="資料詳情"
          payload={(graph.getNodeAttribute(detailNodeId, "payload") as ISigmaNode | undefined)?.data ?? null}
          onClose={closeDetailPanel}
        />
      )}
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
  onEdgeHoverChange?: (edgeId: string | null) => void;
  onRightClickNode?: (event: unknown) => void;
  setSigma?: (sigma: Sigma) => void;
}

const GraphEvents = ({ graph, onHoverChange, onEdgeHoverChange, onRightClickNode, setSigma }: GraphEventsProps) => {
  const loadGraph = useLoadGraph();
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();
  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const didMoveRef = useRef(false);

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
        renderEdgeLabels: true,
        enableEdgeEvents: true,
        defaultDrawEdgeLabel: drawStraightEdgeLabel,
        labelRenderer: drawLabel,
        hoverRenderer: drawLabel,
        defaultDrawNodeLabel: drawLabel,
        defaultDrawNodeHover: drawLabel
    };
    
    const sigmaWithSettings = sigma as unknown as { setSetting: (key: string, value: unknown) => void };
    Object.entries(rendererSettings).forEach(([key, value]) => {
        sigmaWithSettings.setSetting(key, value);
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
      didMoveRef.current = true;
      event.preventDefault();
      event.stopPropagation();
    };

    const stopDragging = () => {
      if (!isDragging) return;
      if (draggedNode && didMoveRef.current) {
        sigma.getGraph().setNodeAttribute(draggedNode, "pinned", true);
      }
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
      if (draggedNode && didMoveRef.current) {
        sigma.getGraph().setNodeAttribute(draggedNode, "pinned", true);
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
        didMoveRef.current = false;
        sigma.getGraph().setNodeAttribute(e.node, "highlighted", true);
        sigma.getCamera().disable();
      },
      enterEdge(e) {
        if (onEdgeHoverChange) onEdgeHoverChange(e.edge);
      },
      leaveEdge() {
        if (onEdgeHoverChange) onEdgeHoverChange(null);
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
  }, [draggedNode, graph, isDragging, onHoverChange, onEdgeHoverChange, registerEvents, sigma, onRightClickNode]);

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

    const icon = type ? iconMapByBusinessType[type] : undefined;

    graph.mergeNode(node.id, {
      label: node.label,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      size,
      color,
      type: icon ? "image" : undefined,
      image: icon,
      payload: node,
      hidden: !isAdvisor, // Initially hide if not advisor
    });
  });

  const edgeIdsByPair = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
    const key = `${edge.source}→${edge.target}`;
    const list = edgeIdsByPair.get(key);
    if (list) list.push(edge.id);
    else edgeIdsByPair.set(key, [edge.id]);
  });

  const curvatureByEdgeId = new Map<string, number>();
  edgeIdsByPair.forEach((edgeIds) => {
    if (edgeIds.length <= 1) return;
    const mid = (edgeIds.length - 1) / 2;
    const step = 0.25;
    edgeIds.forEach((edgeId, index) => {
      const offset = index - mid;
      const curvature = Math.max(-0.9, Math.min(0.9, offset * step));
      curvatureByEdgeId.set(edgeId, curvature);
    });
  });

  edges.forEach((edge) => {
    const isTrans = edge.data?.type === "transactional";
    const color = isTrans ? edgeColorMap.transactional : edgeColorMap.structural;
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
    if (graph.hasEdge(edge.id)) return;

    const isParallel = curvatureByEdgeId.has(edge.id);
    const fallbackLabel = isTrans ? "交易" : "結構";
    const edgeType = isParallel ? "curved" : "arrow";

    try {
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
        color,
        size: isTrans ? 3 : 1,
        label: edge.label ?? fallbackLabel,
        type: edgeType,
        curvature: isParallel ? curvatureByEdgeId.get(edge.id) : undefined,
        weight: isTrans ? 10 : 0.05,
        zIndex: isTrans ? 10 : 0,
        edgeType: edge.data?.type || "structural",
      });
    } catch {
      // ignore
    }
  });

  return graph;
};
