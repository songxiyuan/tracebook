import ELK from 'elkjs/lib/elk.bundled.js'
import type { NormGraph, NormNode } from './normalize'

/**
 * ELK owns geometry (AGENTS.md). This module turns a NormGraph into absolute
 * node positions, **orthogonal edge routes read back from ELK** (the fix for the
 * old bézier tangle: we now consume `edge.sections` instead of letting Vue Flow
 * re-route), and background boxes for lanes / boundaries / stages.
 */

export type Direction = 'TB' | 'BT' | 'LR' | 'RL'
export interface Point { x: number; y: number }
export interface LaidOutNode { id: string; x: number; y: number; width: number; height: number }
export interface GroupBox { id: string; label: string; kind?: string; x: number; y: number; width: number; height: number }
export interface LayoutResult {
  nodes: LaidOutNode[]
  /** edge id → ordered polyline points (start, bends…, end) in graph space. */
  routes: Map<string, Point[]>
  groups: GroupBox[]
  contentHeight: number
}

const elk = new ELK()

/** Node box size. Height grows for a sublabel so ELK reserves the real footprint. */
export function nodeSize(node: NormNode): { width: number; height: number } {
  const height = 56 + (node.sublabel ? 16 : 0)
  return { width: 190, height }
}

function baseOptions(direction: Direction, hasRanks: boolean): Record<string, string> {
  const options: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.spacing.nodeNode': '40',
    'elk.layered.spacing.nodeNodeBetweenLayers': '76',
    'elk.layered.spacing.edgeNodeBetweenLayers': '24',
    'elk.spacing.edgeNode': '18',
    'elk.spacing.edgeEdge': '14',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  }
  // Pin layers to the diagram's logical columns/stages so archify's intended
  // left-to-right ordering survives instead of being re-derived from edges.
  if (hasRanks) options['elk.partitioning.activate'] = 'true'
  return options
}

export async function layoutGraph(graph: NormGraph, direction: Direction): Promise<LayoutResult> {
  const sizes = new Map(graph.nodes.map((node) => [node.id, nodeSize(node)]))
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  const safeEdges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))

  const result = await elk.layout({
    id: 'root',
    layoutOptions: baseOptions(direction, graph.hasRanks),
    children: graph.nodes.map((node) => {
      const size = sizes.get(node.id)!
      const layoutOptions = graph.hasRanks && typeof node.rank === 'number'
        ? { 'elk.partitioning.partition': String(node.rank) }
        : undefined
      return { id: node.id, width: size.width, height: size.height, layoutOptions }
    }),
    edges: safeEdges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  })

  const laidOut: LaidOutNode[] = (result.children ?? []).map((child) => ({
    id: child.id,
    x: child.x ?? 0,
    y: child.y ?? 0,
    width: child.width ?? 190,
    height: child.height ?? 56,
  }))

  const routes = new Map<string, Point[]>()
  type ElkSection = { startPoint?: Point; endPoint?: Point; bendPoints?: Point[] }
  type ElkResultEdge = { id: string; sections?: ElkSection[] }
  for (const edge of (result.edges ?? []) as ElkResultEdge[]) {
    const section = edge.sections?.[0]
    if (!section) continue
    const points: Point[] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      .filter((point): point is Point => !!point && typeof point.x === 'number' && typeof point.y === 'number')
      .map((point) => ({ x: point.x, y: point.y }))
    if (points.length >= 2) routes.set(edge.id, points)
  }

  const groups = groupBoxes(graph, laidOut)
  const contentHeight = laidOut.reduce((tallest, node) => Math.max(tallest, node.y + node.height), 0)
  return { nodes: laidOut, routes, groups, contentHeight }
}

/** Background box per group, sized to hug its member nodes with padding + a title strip. */
function groupBoxes(graph: NormGraph, laidOut: LaidOutNode[]): GroupBox[] {
  if (!graph.groups.length) return []
  const position = new Map(laidOut.map((node) => [node.id, node]))
  const groupOf = new Map(graph.nodes.map((node) => [node.id, node.group]))
  const PAD = 20
  const TITLE = 22
  const boxes: GroupBox[] = []
  for (const group of graph.groups) {
    const members = laidOut.filter((node) => groupOf.get(node.id) === group.id && position.has(node.id))
    if (!members.length) continue
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const node of members) {
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + node.width)
      maxY = Math.max(maxY, node.y + node.height)
    }
    boxes.push({
      id: group.id,
      label: group.label,
      kind: group.kind,
      x: minX - PAD,
      y: minY - PAD - TITLE,
      width: (maxX - minX) + PAD * 2,
      height: (maxY - minY) + PAD * 2 + TITLE,
    })
  }
  // Draw larger boxes first so a nested/smaller group stays visible on top.
  return boxes.sort((a, b) => b.width * b.height - a.width * a.height)
}
