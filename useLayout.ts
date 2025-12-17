import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { type Edge } from '@xyflow/react';
import type { AppNodeType } from '../types';
import { layeredLayoutOptions } from '../constants/layout';

const elk = new ELK();

const NODE_WIDTH = 150;
const NODE_HEIGHT = 50;
const FIRST_RADIUS = 220;
const LEVEL_GAP = 200;
const NODE_MARGIN = 24;
const MIN_ANGLE_DEG = 15;
const MIN_ANGLE_RAD = (MIN_ANGLE_DEG * Math.PI) / 180;
const ARC_EXTRA_BY_DEGREE = 0.15;
const COMPONENT_GAP = 420;
const MAX_RING_ITERATIONS = 12;
const MAX_RADIAL_ITERATIONS = 12;

type Position = { x: number; y: number };
type BoundingBox = { minX: number; maxX: number; minY: number; maxY: number };
type BoundsCenter = { centerX: number; centerY: number };

type LayoutNode = {
  id: string;
  node: AppNodeType;
  width: number;
  height: number;
  locked: boolean;
  sortKey: string;
  degree: number;
};

type LayoutComponentResult = {
  positions: Map<string, Position>;
  bounds: BoundingBox;
  hasLocked: boolean;
};

type LayoutOptions = {
  preferredRootIds?: readonly string[];
  componentPacking?: 'horizontal' | 'vertical';
};

const getNodeSortKey = (node: AppNodeType): string => {
  const data = node.data ?? {};
  const candidates = [
    typeof data.nationalId === 'string' ? data.nationalId.trim() : undefined,
    typeof data.label === 'string' ? data.label.trim() : undefined,
    typeof data.caseName === 'string' ? data.caseName.trim() : undefined,
  ].filter((value): value is string => Boolean(value && value.length > 0));

  return (candidates[0] ?? node.id).toLowerCase();
};

const getNodeDimensions = (node: AppNodeType): { width: number; height: number } => ({
  width: node.measured?.width ?? NODE_WIDTH,
  height: node.measured?.height ?? NODE_HEIGHT,
});

const isNodeLocked = (node: AppNodeType): boolean => {
  const data = node.data as (Record<string, unknown> & { locked?: boolean; isLocked?: boolean }) | undefined;
  if (data?.locked === true || data?.isLocked === true) {
    return true;
  }
  return node.draggable === false;
};

const buildAdjacency = (nodes: AppNodeType[], edges: Edge[]): Map<string, Set<string>> => {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, new Set());
    }
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, new Set());
    }
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  return adjacency;
};

const getConnectedComponents = (
  adjacency: Map<string, Set<string>>,
  nodes: Map<string, LayoutNode>
): string[][] => {
  const components: string[][] = [];
  const visited = new Set<string>();
  const sortedIds = Array.from(nodes.keys()).sort((a, b) => {
    const nodeA = nodes.get(a);
    const nodeB = nodes.get(b);
    const keyA = nodeA?.sortKey ?? a;
    const keyB = nodeB?.sortKey ?? b;
    return keyA.localeCompare(keyB);
  });

  for (const id of sortedIds) {
    if (visited.has(id)) {
      continue;
    }
    const queue: string[] = [id];
    const component: string[] = [];
    visited.add(id);
    while (queue.length > 0) {
      const current = queue.shift() as string;
      component.push(current);
      const neighbors = adjacency.get(current);
      if (!neighbors) {
        continue;
      }
      const sortedNeighbors = Array.from(neighbors).sort((a, b) => {
        const keyA = nodes.get(a)?.sortKey ?? a;
        const keyB = nodes.get(b)?.sortKey ?? b;
        return keyA.localeCompare(keyB);
      });
      for (const neighbor of sortedNeighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
};

const selectPseudoRoots = (
  componentNodes: LayoutNode[],
  preferredRootIds: ReadonlySet<string>
): LayoutNode[] => {
  if (preferredRootIds.size > 0) {
    return componentNodes
      .filter(node => preferredRootIds.has(node.id))
      .sort((a, b) => {
        if (b.degree !== a.degree) {
          return b.degree - a.degree;
        }
        return a.sortKey.localeCompare(b.sortKey);
      });
  }
  const sortedByDegree = [...componentNodes].sort((a, b) => {
    if (b.degree !== a.degree) {
      return b.degree - a.degree;
    }
    return a.sortKey.localeCompare(b.sortKey);
  });
  const highestDegree = sortedByDegree[0]?.degree ?? 0;
  if (highestDegree === 0) {
    return sortedByDegree.slice(0, 1);
  }
  const threshold = Math.max(3, Math.floor(highestDegree * 0.7));
  const pseudoRoots = sortedByDegree.filter(node => node.degree >= threshold);
  return pseudoRoots.length > 0 ? pseudoRoots : sortedByDegree.slice(0, 1);
};

const toBoundingBox = (positions: Map<string, Position>, nodes: Map<string, LayoutNode>): BoundingBox => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  positions.forEach((pos, id) => {
    const meta = nodes.get(id);
    if (!meta) {
      return;
    }
    const halfW = meta.width / 2;
    const halfH = meta.height / 2;
    minX = Math.min(minX, pos.x - halfW);
    maxX = Math.max(maxX, pos.x + halfW);
    minY = Math.min(minY, pos.y - halfH);
    maxY = Math.max(maxY, pos.y + halfH);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  return { minX, maxX, minY, maxY };
};

const mergeBoundingBoxes = (a: BoundingBox, b: BoundingBox): BoundingBox => ({
  minX: Math.min(a.minX, b.minX),
  maxX: Math.max(a.maxX, b.maxX),
  minY: Math.min(a.minY, b.minY),
  maxY: Math.max(a.maxY, b.maxY),
});

const getBoundsCenter = (bounds: BoundingBox): BoundsCenter => ({
  centerX: (bounds.minX + bounds.maxX) / 2,
  centerY: (bounds.minY + bounds.maxY) / 2,
});

const boxOverlap = (
  a: Position,
  aMeta: LayoutNode,
  b: Position,
  bMeta: LayoutNode,
  padding: number
): boolean => {
  const halfWA = aMeta.width / 2 + padding;
  const halfWB = bMeta.width / 2 + padding;
  const halfHA = aMeta.height / 2 + padding;
  const halfHB = bMeta.height / 2 + padding;
  return Math.abs(a.x - b.x) < halfWA + halfWB && Math.abs(a.y - b.y) < halfHA + halfHB;
};

const computeMindMapLayout = (
  nodesToLayout: AppNodeType[],
  edgesToLayout: Edge[],
  options?: LayoutOptions
): Map<string, Position> => {
  const adjacency = buildAdjacency(nodesToLayout, edgesToLayout);
  const nodes = new Map<string, LayoutNode>();
  nodesToLayout.forEach(node => {
    const dimensions = getNodeDimensions(node);
    const locked = isNodeLocked(node);
    const degree = adjacency.get(node.id)?.size ?? 0;
    nodes.set(node.id, {
      id: node.id,
      node,
      width: dimensions.width,
      height: dimensions.height,
      locked,
      sortKey: getNodeSortKey(node),
      degree,
    });
  });

  const components = getConnectedComponents(adjacency, nodes);
  const preferredRootIds = new Set(options?.preferredRootIds ?? []);
  const componentResults: LayoutComponentResult[] = [];

  for (const component of components) {
    const componentSet = new Set(component);
    const componentNodes = component.map(id => nodes.get(id)).filter((meta): meta is LayoutNode => Boolean(meta));
    if (componentNodes.length === 0) {
      componentResults.push({
        positions: new Map<string, Position>(),
        bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        hasLocked: false,
      });
      continue;
    }

    const pseudoRoots = selectPseudoRoots(componentNodes, preferredRootIds);
    const hasMultiRoots = pseudoRoots.length > 1;

    const unassigned = new Set(component);
    const parentById = new Map<string, string | null>();
    const depthById = new Map<string, number>();
    const treeById = new Map<string, string>();

    for (const root of pseudoRoots) {
      if (!unassigned.has(root.id)) {
        continue;
      }
      const queue: string[] = [root.id];
      unassigned.delete(root.id);
      parentById.set(root.id, null);
      depthById.set(root.id, 0);
      treeById.set(root.id, root.id);

      while (queue.length > 0) {
        const current = queue.shift() as string;
        const neighbors = adjacency.get(current);
        if (!neighbors) {
          continue;
        }
        const ordered = Array.from(neighbors)
          .filter(id => componentSet.has(id))
          .sort((a, b) => {
            const keyA = nodes.get(a)?.sortKey ?? a;
            const keyB = nodes.get(b)?.sortKey ?? b;
            return keyA.localeCompare(keyB);
          });
        for (const neighbor of ordered) {
          if (!unassigned.has(neighbor)) {
            continue;
          }
          unassigned.delete(neighbor);
          parentById.set(neighbor, current);
          const parentDepth = depthById.get(current) ?? 0;
          depthById.set(neighbor, parentDepth + 1);
          treeById.set(neighbor, root.id);
          queue.push(neighbor);
        }
      }
    }

    if (unassigned.size > 0) {
      const fallbackRoot = pseudoRoots[0];
      for (const orphan of Array.from(unassigned)) {
        unassigned.delete(orphan);
        parentById.set(orphan, fallbackRoot.id);
        depthById.set(orphan, 1);
        treeById.set(orphan, fallbackRoot.id);
      }
    }

    const nodesByTree = new Map<string, LayoutNode[]>();
    componentNodes.forEach(meta => {
      const treeId = treeById.get(meta.id) ?? meta.id;
      const list = nodesByTree.get(treeId);
      if (list) {
        list.push(meta);
      } else {
        nodesByTree.set(treeId, [meta]);
      }
    });

    const treeWeights = new Map<string, number>();
    nodesByTree.forEach((list, treeId) => {
      let total = 0;
      list.forEach(meta => {
        const weightBase = Math.max(meta.width, meta.height) + NODE_MARGIN;
        const multiplier = 1 + ARC_EXTRA_BY_DEGREE * meta.degree;
        total += weightBase * multiplier;
      });
      treeWeights.set(treeId, total);
    });

    const totalWeight = Array.from(treeWeights.values()).reduce((sum, weight) => sum + weight, 0);
    const treeOrder = pseudoRoots.map(root => root.id);
    let sectorCursor = -Math.PI;
    const sectorByTree = new Map<string, { start: number; end: number }>();
    const angleAllocations: number[] = [];
    pseudoRoots.forEach(root => {
      const weight = treeWeights.get(root.id) ?? 1;
      const minAngle = MIN_ANGLE_RAD * Math.max(1, (nodesByTree.get(root.id) ?? []).length);
      const assigned = Math.max(minAngle, (2 * Math.PI * weight) / Math.max(totalWeight, 1));
      angleAllocations.push(assigned);
    });
    const sumAngles = angleAllocations.reduce((sum, value) => sum + value, 0);
    const scale = sumAngles > 0 ? (2 * Math.PI) / sumAngles : 1;
    pseudoRoots.forEach((root, index) => {
      const span = angleAllocations[index] * scale;
      sectorByTree.set(root.id, { start: sectorCursor, end: sectorCursor + span });
      sectorCursor += span;
    });

    const angleById = new Map<string, number>();
    const clusterDepthById = new Map<string, number>();
    const childrenById = new Map<string, string[]>();

    parentById.forEach((parent, child) => {
      if (parent) {
        const list = childrenById.get(parent);
        if (list) {
          list.push(child);
        } else {
          childrenById.set(parent, [child]);
        }
      }
    });

    const assignAngles = (nodeId: string, startAngle: number, endAngle: number, depth: number) => {
      const angle = (startAngle + endAngle) / 2;
      angleById.set(nodeId, angle);
      clusterDepthById.set(nodeId, depth);
      const children = childrenById.get(nodeId);
      if (!children || children.length === 0) {
        return;
      }
      const sortedChildren = [...children].sort((a, b) => {
        const keyA = nodes.get(a)?.sortKey ?? a;
        const keyB = nodes.get(b)?.sortKey ?? b;
        return keyA.localeCompare(keyB);
      });
      const childWeights = sortedChildren.map(child => {
        const meta = nodes.get(child);
        if (!meta) {
          return 1;
        }
        const base = Math.max(meta.width, meta.height) + NODE_MARGIN;
        const multiplier = 1 + ARC_EXTRA_BY_DEGREE * meta.degree;
        return base * multiplier;
      });
      const totalChildWeight = childWeights.reduce((sum, value) => sum + value, 0);
      let cursor = startAngle;
      sortedChildren.forEach((child, index) => {
        const weightRatio = totalChildWeight > 0 ? childWeights[index] / totalChildWeight : 1 / sortedChildren.length;
        const span = (endAngle - startAngle) * weightRatio;
        const childStart = cursor;
        const childEnd = cursor + span;
        assignAngles(child, childStart, childEnd, depth + 1);
        cursor += span;
      });
    };

    treeOrder.forEach(treeId => {
      const root = pseudoRoots.find(item => item.id === treeId);
      const sector = sectorByTree.get(treeId);
      if (!root || !sector) {
        return;
      }
      const rootRadiusAngle = (sector.start + sector.end) / 2;
      angleById.set(root.id, rootRadiusAngle);
      clusterDepthById.set(root.id, 0);
      assignAngles(root.id, sector.start, sector.end, 0);
    });

    let maxDepth = 0;
    clusterDepthById.forEach(depth => {
      maxDepth = Math.max(maxDepth, depth);
    });

    const baseRadiusByDepth = new Map<number, number>();
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      if (depth === 0) {
        baseRadiusByDepth.set(depth, hasMultiRoots ? FIRST_RADIUS * 0.6 : 0);
      } else {
        const start = hasMultiRoots ? FIRST_RADIUS * 1.6 : FIRST_RADIUS;
        baseRadiusByDepth.set(depth, start + LEVEL_GAP * (depth - 1));
      }
    }

    const depthOffsets = new Map<number, number>();
    const addDepthOffset = (depth: number, delta: number) => {
      for (let d = depth; d <= maxDepth; d += 1) {
        depthOffsets.set(d, (depthOffsets.get(d) ?? 0) + delta);
      }
    };

    const getRadiusForDepth = (depth: number): number => {
      const base = baseRadiusByDepth.get(depth) ?? 0;
      const extra = depthOffsets.get(depth) ?? 0;
      return base + extra;
    };

    const getComputedPosition = (id: string): Position => {
      const meta = nodes.get(id);
      const angle = angleById.get(id) ?? 0;
      const depth = clusterDepthById.get(id) ?? 0;
      const radius = getRadiusForDepth(depth);
      if (!meta) {
        return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
      }
      if (meta.locked && meta.node.position) {
        return meta.node.position;
      }
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    };

    const movableNodes = componentNodes.filter(meta => !meta.locked);
    const lockedNodes = componentNodes.filter(meta => meta.locked);

    let iterations = 0;
    let adjusted = true;
    while (adjusted && iterations < MAX_RING_ITERATIONS) {
      adjusted = false;
      iterations += 1;
      for (let depth = 0; depth <= maxDepth; depth += 1) {
        const nodesAtDepth = movableNodes.filter(meta => (clusterDepthById.get(meta.id) ?? 0) === depth);
        if (nodesAtDepth.length < 2) {
          continue;
        }
        const sorted = nodesAtDepth.sort((a, b) => {
          const angleA = angleById.get(a.id) ?? 0;
          const angleB = angleById.get(b.id) ?? 0;
          return angleA - angleB;
        });
        const testPairs: Array<[LayoutNode, LayoutNode]> = [];
        for (let idx = 0; idx < sorted.length; idx += 1) {
          const next = (idx + 1) % sorted.length;
          if (idx === sorted.length - 1 && sorted.length < 3) {
            break;
          }
          testPairs.push([sorted[idx], sorted[next]]);
        }
        let overlapped = false;
        for (const [left, right] of testPairs) {
          const leftPos = getComputedPosition(left.id);
          const rightPos = getComputedPosition(right.id);
          if (boxOverlap(leftPos, left, rightPos, right, NODE_MARGIN / 2)) {
            addDepthOffset(depth, NODE_MARGIN);
            overlapped = true;
            break;
          }
        }
        if (overlapped) {
          adjusted = true;
          break;
        }
      }
    }

    iterations = 0;
    adjusted = true;
    while (adjusted && iterations < MAX_RADIAL_ITERATIONS) {
      adjusted = false;
      iterations += 1;
      for (let depth = 0; depth < maxDepth; depth += 1) {
        const innerNodes = movableNodes.filter(meta => (clusterDepthById.get(meta.id) ?? 0) === depth);
        const outerNodes = movableNodes.filter(meta => (clusterDepthById.get(meta.id) ?? 0) === depth + 1);
        if (innerNodes.length === 0 || outerNodes.length === 0) {
          continue;
        }
        let overlapped = false;
        for (const inner of innerNodes) {
          const innerPos = getComputedPosition(inner.id);
          for (const outer of outerNodes) {
            const outerPos = getComputedPosition(outer.id);
            if (boxOverlap(innerPos, inner, outerPos, outer, NODE_MARGIN / 2)) {
              addDepthOffset(depth + 1, NODE_MARGIN);
              overlapped = true;
              break;
            }
          }
          if (overlapped) {
            break;
          }
        }
        if (overlapped) {
          adjusted = true;
          break;
        }
      }
    }

    lockedNodes.forEach(locked => {
      const lockedPos = locked.node.position ?? { x: 0, y: 0 };
      movableNodes.forEach(meta => {
        const depth = clusterDepthById.get(meta.id) ?? 0;
        const currentPos = getComputedPosition(meta.id);
        let guard = 0;
        while (boxOverlap(lockedPos, locked, currentPos, meta, NODE_MARGIN / 2) && guard < MAX_RADIAL_ITERATIONS) {
          addDepthOffset(depth, NODE_MARGIN / 2);
          guard += 1;
        }
      });
    });

    const positions = new Map<string, Position>();
    componentNodes.forEach(meta => {
      if (meta.locked && meta.node.position) {
        positions.set(meta.id, meta.node.position);
        return;
      }
      const angle = angleById.get(meta.id) ?? 0;
      const depth = clusterDepthById.get(meta.id) ?? 0;
      const radius = getRadiusForDepth(depth);
      positions.set(meta.id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    });

    const bounds = toBoundingBox(positions, nodes);
    componentResults.push({
      positions,
      bounds,
      hasLocked: lockedNodes.length > 0,
    });
  }

  const finalPositions = new Map<string, Position>();
  let packingOffsetX = 0;
  let packingOffsetY = 0;
  let aggregateBounds: BoundingBox | null = null;
  const packingDirection = options?.componentPacking ?? 'horizontal';
  let anyLockedComponent = false;

  componentResults.forEach(result => {
    if (result.positions.size === 0) {
      return;
    }
    if (result.hasLocked) {
      anyLockedComponent = true;
      result.positions.forEach((pos, id) => {
        finalPositions.set(id, pos);
      });
      if (aggregateBounds !== null) {
        aggregateBounds = mergeBoundingBoxes(aggregateBounds, result.bounds);
      } else {
        aggregateBounds = result.bounds;
      }
      return;
    }
    const width = result.bounds.maxX - result.bounds.minX;
    const height = result.bounds.maxY - result.bounds.minY;
    const offset =
      packingDirection === 'vertical'
        ? { x: -result.bounds.minX, y: packingOffsetY - result.bounds.minY }
        : { x: packingOffsetX - result.bounds.minX, y: -result.bounds.minY };
    result.positions.forEach((pos, id) => {
      finalPositions.set(id, { x: pos.x + offset.x, y: pos.y + offset.y });
    });
    const shiftedBounds: BoundingBox = {
      minX: result.bounds.minX + offset.x,
      maxX: result.bounds.maxX + offset.x,
      minY: result.bounds.minY + offset.y,
      maxY: result.bounds.maxY + offset.y,
    };
    if (aggregateBounds !== null) {
      aggregateBounds = mergeBoundingBoxes(aggregateBounds, shiftedBounds);
    } else {
      aggregateBounds = shiftedBounds;
    }

    if (packingDirection === 'vertical') {
      packingOffsetY += height + COMPONENT_GAP;
    } else {
      packingOffsetX += width + COMPONENT_GAP;
    }
  });

  const centeredBounds = aggregateBounds;
  if (!anyLockedComponent && centeredBounds !== null) {
    const { centerX, centerY } = getBoundsCenter(centeredBounds);
    finalPositions.forEach((pos, id) => {
      finalPositions.set(id, { x: pos.x - centerX, y: pos.y - centerY });
    });
  }

  nodesToLayout.forEach(node => {
    if (!finalPositions.has(node.id)) {
      finalPositions.set(node.id, node.position ?? { x: 0, y: 0 });
    }
  });

  return finalPositions;
};

const mapEdgesWithHandles = (edges: Edge[], positions: Map<string, Position>): Edge[] =>
  edges.map(edge => {
    const sourcePosition = positions.get(edge.source) ?? { x: 0, y: 0 };
    const targetPosition = positions.get(edge.target) ?? { x: 0, y: 0 };
    const dx = targetPosition.x - sourcePosition.x;
    const dy = targetPosition.y - sourcePosition.y;
    const sourceHandle = decideHandle(dx, dy);
    const targetHandle = decideHandle(-dx, -dy);
    return {
      ...edge,
      sourceHandle,
      targetHandle,
    };
  });

const decideHandle = (dx: number, dy: number): 'left' | 'right' | 'top' | 'bottom' => {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
};

const runElkLayout = async (nodesToLayout: AppNodeType[], edgesToLayout: Edge[]): Promise<Map<string, Position>> => {
  const elkNodes: ElkNode[] = nodesToLayout.map(node => ({
    id: node.id,
    width: node.measured?.width ?? NODE_WIDTH,
    height: node.measured?.height ?? NODE_HEIGHT,
  }));
  const elkEdges = edgesToLayout.map(edge => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: layeredLayoutOptions,
    children: elkNodes,
    edges: elkEdges,
  };
  const layoutedGraph = await elk.layout(graph);
  const positionMap = new Map<string, Position>();
  layoutedGraph.children?.forEach(child => {
    if (child?.id) {
      positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
    }
  });
  return positionMap;
};

export function useLayout(
  setNodes: Dispatch<SetStateAction<AppNodeType[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>
) {
  const [isLayouting, setIsLayouting] = useState(false);

  const applyLayout = useCallback(
    async (nodesToLayout: AppNodeType[], edgesToLayout: Edge[]) => {
      if (nodesToLayout.length === 0) {
        setNodes([]);
        return;
      }

      setIsLayouting(true);

      try {
        const positions = computeMindMapLayout(nodesToLayout, edgesToLayout, {
          componentPacking: 'horizontal',
        });
        const finalNodes = nodesToLayout.map(node => ({
          ...node,
          position: positions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
        }));
        const finalEdges = mapEdgesWithHandles(edgesToLayout, positions);
        setNodes(finalNodes);
        setEdges(finalEdges);
      } catch (error) {
        console.log('Radial layout failed, fallback to ELK:', error);
        try {
          const positions = await runElkLayout(nodesToLayout, edgesToLayout);
          const finalNodes = nodesToLayout.map(node => ({
            ...node,
            position: positions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
          }));
          const finalEdges = mapEdgesWithHandles(edgesToLayout, positions);
          setNodes(finalNodes);
          setEdges(finalEdges);
        } catch (elkError) {
          console.log('ELK layout failed:', elkError);
        }
      } finally {
        setIsLayouting(false);
      }
    },
    [setNodes, setEdges]
  );

  return { isLayouting, applyLayout };
}
