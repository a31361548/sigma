import { useEffect, useRef } from "react";
import { useSigma } from "@react-sigma/core";
import ELK from "elkjs/lib/elk.bundled";
import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk.bundled";
import type { ISigmaNode, NodePayload } from "../../interfaces/mock/IMockData";

interface ElkLayoutProps {
  layoutType?: "layered" | "radial" | "mrtree" | "force";
  onLayoutStop?: () => void;
  isLayoutActive: boolean;
}

const elk = new ELK();

export const ElkLayout = ({ layoutType = "layered", onLayoutStop, isLayoutActive }: ElkLayoutProps) => {
  const sigma = useSigma();
  const graph = sigma.getGraph() as unknown as DirectedGraphLike;
  const layoutRunning = useRef(false);
  const layoutRunId = useRef(0);

  useEffect(() => {
    if (!isLayoutActive || graph.order === 0 || layoutRunning.current) return;

    layoutRunId.current += 1;
    const runId = layoutRunId.current;
    layoutRunning.current = true;

    void (async () => {
      try {
        const groups = buildAdvisorGroups(graph);
        if (groups.length === 0) return;

        const placed = await layoutAndPackGroups({
          graph,
          groups,
          layoutType,
        });

        if (layoutRunId.current !== runId) return;

        placed.forEach(({ nodeId, x, y }) => {
          graph.setNodeAttribute(nodeId, "x", x);
          graph.setNodeAttribute(nodeId, "y", y);
        });

        if (onLayoutStop) onLayoutStop();
      } catch (err) {
        console.error("ELK Layout Error:", err);
      } finally {
        if (layoutRunId.current === runId) layoutRunning.current = false;
      }
    })();

    return () => {
      layoutRunId.current += 1;
      layoutRunning.current = false;
    };
  }, [graph, layoutType, onLayoutStop, sigma, isLayoutActive]);

  return null;
};

type NodeId = string;
type EdgeId = string;

interface DirectedGraphLike {
  order: number;
  forEachNode(callback: (nodeId: NodeId, attributes: Record<string, unknown>) => void): void;
  forEachEdge(callback: (edgeId: EdgeId, attributes: Record<string, unknown>, source: NodeId, target: NodeId) => void): void;
  forEachInEdge(
    nodeId: NodeId,
    callback: (edgeId: EdgeId, attributes: Record<string, unknown>, source: NodeId, target: NodeId) => void,
  ): void;
  forEachNeighbor(nodeId: NodeId, callback: (neighborId: NodeId) => void): void;
  getNodeAttribute(nodeId: NodeId, attributeName: string): unknown;
  setNodeAttribute(nodeId: NodeId, attributeName: string, value: unknown): void;
}

type BusinessType = NodePayload["metaData"]["businessType"];

type LayoutAlgorithm = "layered" | "radial" | "mrtree";

type AdvisorGroup = {
  groupId: string;
  advisorId: string;
  advisorOrderIndex: number;
  nodeIds: ReadonlyArray<NodeId>;
};

function buildAdvisorGroups(graph: DirectedGraphLike): AdvisorGroup[] {
  const advisorIdsInOrder: NodeId[] = [];
  const businessTypeCache = new Map<NodeId, BusinessType | null>();

  graph.forEachNode((nodeId) => {
    const businessType = getBusinessType(graph, nodeId, businessTypeCache);
    if (businessType === "理專") advisorIdsInOrder.push(nodeId);
  });

  if (advisorIdsInOrder.length === 0) return [];

  const advisorOrderIndex = new Map<NodeId, number>();
  advisorIdsInOrder.forEach((advisorId, index) => advisorOrderIndex.set(advisorId, index));

  const nodeAdvisorCache = new Map<NodeId, NodeId | null>();
  const disjointSet = new DisjointSet(advisorIdsInOrder);

  graph.forEachEdge((_edgeId, _attributes, source, target) => {
    const a = inferAdvisor(graph, source, businessTypeCache, nodeAdvisorCache);
    const b = inferAdvisor(graph, target, businessTypeCache, nodeAdvisorCache);
    if (!a || !b) return;
    disjointSet.union(a, b);
  });

  const byGroup = new Map<string, { advisorId: NodeId; advisorOrderIndex: number; nodeIds: NodeId[] }>();

  graph.forEachNode((nodeId) => {
    const advisor = inferAdvisor(graph, nodeId, businessTypeCache, nodeAdvisorCache);
    if (!advisor) return;
    const groupId = disjointSet.find(advisor);
    const group = byGroup.get(groupId);
    if (!group) {
      const reprAdvisorId = pickRepresentativeAdvisor(disjointSet, advisorIdsInOrder, groupId);
      byGroup.set(groupId, {
        advisorId: reprAdvisorId,
        advisorOrderIndex: advisorOrderIndex.get(reprAdvisorId) ?? Number.MAX_SAFE_INTEGER,
        nodeIds: [nodeId],
      });
      return;
    }
    group.nodeIds.push(nodeId);
  });

  return [...byGroup.entries()]
    .map(([groupId, group]) => ({
      groupId,
      advisorId: group.advisorId,
      advisorOrderIndex: group.advisorOrderIndex,
      nodeIds: group.nodeIds,
    }))
    .sort((a, b) => a.advisorOrderIndex - b.advisorOrderIndex);
}

function pickRepresentativeAdvisor(disjointSet: DisjointSet, advisorIdsInOrder: NodeId[], groupId: string): NodeId {
  for (const advisorId of advisorIdsInOrder) {
    if (disjointSet.find(advisorId) === groupId) return advisorId;
  }
  return advisorIdsInOrder[0] ?? groupId;
}

function getBusinessType(
  graph: DirectedGraphLike,
  nodeId: NodeId,
  cache: Map<NodeId, BusinessType | null>,
): BusinessType | null {
  const existing = cache.get(nodeId);
  if (existing !== undefined) return existing;

  const payload = graph.getNodeAttribute(nodeId, "payload");
  const businessType = readBusinessTypeFromPayload(payload);
  cache.set(nodeId, businessType);
  return businessType;
}

function readBusinessTypeFromPayload(payload: unknown): BusinessType | null {
  if (!isRecord(payload)) return null;

  const node = payload as Partial<ISigmaNode>;
  const data = node.data;
  if (!data) return null;

  const metaData = data.metaData;
  if (!metaData) return null;

  const businessType = metaData.businessType;
  return businessType ?? null;
}

function inferAdvisor(
  graph: DirectedGraphLike,
  nodeId: NodeId,
  businessTypeCache: Map<NodeId, BusinessType | null>,
  nodeAdvisorCache: Map<NodeId, NodeId | null>,
): NodeId | null {
  const existing = nodeAdvisorCache.get(nodeId);
  if (existing !== undefined) return existing;

  const businessType = getBusinessType(graph, nodeId, businessTypeCache);
  if (businessType === "理專") {
    nodeAdvisorCache.set(nodeId, nodeId);
    return nodeId;
  }

  const visited = new Set<NodeId>([nodeId]);
  let current: NodeId | null = nodeId;
  for (let depth = 0; depth < 10 && current; depth++) {
    const parent = getInboundStructuralParent(graph, current);
    if (!parent) break;
    if (visited.has(parent)) break;
    visited.add(parent);

    const parentType = getBusinessType(graph, parent, businessTypeCache);
    if (parentType === "理專") {
      nodeAdvisorCache.set(nodeId, parent);
      return parent;
    }
    current = parent;
  }

  const inferredFromNeighbor = inferAdvisorFromNeighbors(graph, nodeId, businessTypeCache, nodeAdvisorCache);
  nodeAdvisorCache.set(nodeId, inferredFromNeighbor);
  return inferredFromNeighbor;
}

function inferAdvisorFromNeighbors(
  graph: DirectedGraphLike,
  nodeId: NodeId,
  businessTypeCache: Map<NodeId, BusinessType | null>,
  nodeAdvisorCache: Map<NodeId, NodeId | null>,
): NodeId | null {
  let inferred: NodeId | null = null;
  graph.forEachNeighbor(nodeId, (neighborId) => {
    if (inferred) return;
    const maybeAdvisor = inferAdvisor(graph, neighborId, businessTypeCache, nodeAdvisorCache);
    if (maybeAdvisor) inferred = maybeAdvisor;
  });
  return inferred;
}

function getInboundStructuralParent(graph: DirectedGraphLike, nodeId: NodeId): NodeId | null {
  let parent: NodeId | null = null;
  graph.forEachInEdge(nodeId, (_edgeId, attributes, source) => {
    if (parent) return;
    const edgeType = readEdgeType(attributes);
    if (edgeType === "structural") parent = source;
  });
  return parent;
}

type EdgeType = "structural" | "transactional" | null;

function readEdgeType(attributes: Record<string, unknown>): EdgeType {
  const edgeType = attributes.edgeType;
  if (edgeType === "structural" || edgeType === "transactional") return edgeType;
  return null;
}

type LayoutRequest = {
  graph: DirectedGraphLike;
  groups: ReadonlyArray<AdvisorGroup>;
  layoutType: ElkLayoutProps["layoutType"];
};

type PlacedNode = { nodeId: NodeId; x: number; y: number };

async function layoutAndPackGroups(request: LayoutRequest): Promise<PlacedNode[]> {
  const algorithm = toElkAlgorithm(request.layoutType);
  const groupGap = 300;

  const groupLayouts = await Promise.all(
    request.groups.map(async (group) => {
      const result = await runElkForGroup({
        graph: request.graph,
        group,
        algorithm,
      });
      const bbox = computeBoundingBox(result.positions);
      const radius = bbox
        ? Math.sqrt(bbox.width * bbox.width + bbox.height * bbox.height) / 2 + groupGap
        : groupGap;

      return {
        group,
        positions: normalizeToCenter(result.positions, bbox),
        radius,
      };
    }),
  );

  const centerGroupId = groupLayouts[0]?.group.groupId ?? "";
  const circles = packCircles({
    circles: groupLayouts.map((g) => ({ id: g.group.groupId, radius: g.radius })),
    centerId: centerGroupId,
  });

  const placedNodes: PlacedNode[] = [];
  groupLayouts.forEach((groupLayout) => {
    const circle = circles.get(groupLayout.group.groupId);
    const offsetX = circle?.x ?? 0;
    const offsetY = circle?.y ?? 0;

    groupLayout.positions.forEach((pos) => {
      placedNodes.push({
        nodeId: pos.nodeId,
        x: pos.x + offsetX,
        y: pos.y + offsetY,
      });
    });
  });

  return placedNodes;
}

function toElkAlgorithm(layoutType: ElkLayoutProps["layoutType"]): LayoutAlgorithm {
  if (layoutType === "radial") return "radial";
  if (layoutType === "mrtree") return "mrtree";
  return "layered";
}

type GroupElkResult = { positions: ReadonlyArray<PlacedNode> };

async function runElkForGroup(input: {
  graph: DirectedGraphLike;
  group: AdvisorGroup;
  algorithm: LayoutAlgorithm;
}): Promise<GroupElkResult> {
  const nodeIdSet = new Set(input.group.nodeIds);

  const nodeSizing = new Map<NodeId, { width: number; height: number }>();
  const elkNodes: ElkNode[] = input.group.nodeIds.map((nodeId) => {
    const sizeValue = readNumeric(input.graph.getNodeAttribute(nodeId, "size")) ?? 10;
    const width = sizeValue * 2 + 150;
    const height = sizeValue * 2 + 20;
    nodeSizing.set(nodeId, { width, height });
    return { id: nodeId, width, height };
  });

  const elkEdges: ElkExtendedEdge[] = [];
  input.graph.forEachEdge((edgeId, attributes, source, target) => {
    if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) return;
    const edgeType = readEdgeType(attributes);
    if (edgeType !== "structural") return;
    elkEdges.push({ id: edgeId, sources: [source], targets: [target] });
  });

  const layoutOptions = buildElkLayoutOptions(input.algorithm);

  const graphPayload: ElkNode = {
    id: "root",
    layoutOptions,
    children: elkNodes,
    edges: elkEdges,
  };

  const layoutedGraph = await elk.layout(graphPayload);
  const positions: PlacedNode[] = [];

  layoutedGraph.children?.forEach((node) => {
    if (node.x === undefined || node.y === undefined) return;
    const size = nodeSizing.get(node.id);
    const width = node.width ?? size?.width ?? 0;
    const height = node.height ?? size?.height ?? 0;
    positions.push({
      nodeId: node.id,
      x: node.x + width / 2,
      y: node.y + height / 2,
    });
  });

  return { positions };
}

function buildElkLayoutOptions(algorithm: LayoutAlgorithm): Record<string, string> {
  if (algorithm === "radial") {
    return {
      "elk.algorithm": "radial",
      "elk.spacing.nodeNode": "150",
      "elk.spacing.edgeNode": "60",
    };
  }

  if (algorithm === "mrtree") {
    return {
      "elk.algorithm": "mrtree",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "150",
      "elk.spacing.edgeNode": "60",
    };
  }

  return {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",

    "elk.separateConnectedComponents": "false",

    "elk.spacing.nodeNode": "150",
    "elk.layered.spacing.layerNodeBetweenLayers": "350",
    "elk.spacing.edgeNode": "60",
  };
}

function readNumeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type BoundingBox = { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };

function computeBoundingBox(points: ReadonlyArray<PlacedNode>): BoundingBox | null {
  if (points.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  points.forEach((p) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function normalizeToCenter(points: ReadonlyArray<PlacedNode>, bbox: BoundingBox | null): ReadonlyArray<PlacedNode> {
  if (!bbox) return points;
  const centerX = bbox.minX + bbox.width / 2;
  const centerY = bbox.minY + bbox.height / 2;
  return points.map((p) => ({ nodeId: p.nodeId, x: p.x - centerX, y: p.y - centerY }));
}

type Circle = { id: string; radius: number };
type PackedCircle = { id: string; x: number; y: number; radius: number };

function packCircles(input: {
  circles: ReadonlyArray<Circle>;
  centerId: string;
}): Map<string, PackedCircle> {
  const circles = [...input.circles].sort((a, b) => b.radius - a.radius);
  const byId = new Map(circles.map((c) => [c.id, c]));

  const center = byId.get(input.centerId) ?? circles[0];
  const remaining = circles.filter((c) => c.id !== center?.id);

  const placed: PackedCircle[] = [];
  if (center) placed.push({ id: center.id, x: 0, y: 0, radius: center.radius });

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const step = Math.max(...circles.map((c) => c.radius), 500);

  remaining.forEach((circle) => {
    let k = 1;
    while (k < 20000) {
      const theta = k * goldenAngle;
      const r = step * Math.sqrt(k);
      const candidate: PackedCircle = { id: circle.id, x: Math.cos(theta) * r, y: Math.sin(theta) * r, radius: circle.radius };

      const ok = placed.every((p) => {
        const dx = p.x - candidate.x;
        const dy = p.y - candidate.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist >= p.radius + candidate.radius;
      });

      if (ok) {
        placed.push(candidate);
        break;
      }
      k++;
    }
  });

  return new Map(placed.map((p) => [p.id, p]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class DisjointSet {
  private readonly parent: Map<string, string>;

  public constructor(items: ReadonlyArray<string>) {
    this.parent = new Map(items.map((item) => [item, item]));
  }

  public find(item: string): string {
    const parent = this.parent.get(item);
    if (!parent) return item;
    if (parent === item) return item;
    const root = this.find(parent);
    this.parent.set(item, root);
    return root;
  }

  public union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    this.parent.set(rootB, rootA);
  }
}
