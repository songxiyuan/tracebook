import type { FlowBlock } from '../../../src/core/model'
import type { ArchifyDiagram } from '../../../src/core/archify'

/**
 * A render-agnostic graph the FlowBlock draws with ELK + Vue Flow. Every flow
 * variant — the basic node/edge graph and each embedded archify diagram — is
 * flattened into this one shape here, so the layout and the component never
 * branch on `variant`.
 *
 * Only *semantic* fields survive: a node's logical column (`rank`), its group
 * (lane / boundary / stage), its role colour (`kind`) and shape. Archify's
 * pixel/routing hints (via, channelX/Y, viewBox, side, label offsets, pos,
 * size) are deliberately dropped — ELK owns geometry (AGENTS.md).
 */
export type NormShape = 'box' | 'diamond' | 'pill'

export interface NormNode {
  id: string
  label: string
  /** Colour token resolved to a CSS `.kind-*` class (componentType or lifecycle state type). */
  kind?: string
  sublabel?: string
  tag?: string
  /** Lane / boundary / stage id this node belongs to, if any. */
  group?: string
  /** Logical column / stage; drives ELK layer partitioning when present. */
  rank?: number
  shape: NormShape
  details?: string
  artifactRefs?: string[]
  relatedBlockIds?: string[]
  metadata?: Record<string, unknown>
}

export type EdgeRole = 'main' | 'branch' | 'async' | 'return' | 'error'
export type EdgeVariant = 'default' | 'emphasis' | 'security' | 'dashed'

export interface NormEdge {
  id: string
  source: string
  target: string
  label?: string
  role?: EdgeRole
  variant?: EdgeVariant
  details?: string
}

export interface NormGroup {
  id: string
  label: string
  /** e.g. 'lane' | 'region' | 'security-group' | 'stage'; only used for styling. */
  kind?: string
}

export interface NormGraph {
  nodes: NormNode[]
  edges: NormEdge[]
  groups: NormGroup[]
  /** True when nodes carry a meaningful `rank`, so ELK should pin layers to it. */
  hasRanks: boolean
}

function edgeId(provided: string | undefined, source: string, target: string, index: number): string {
  return provided ?? `${source}__${target}__${index}`
}

// __NORMALIZE_BODY__

/** Flatten any flow block into the graph the layout and renderer consume. */
export function normalize(block: FlowBlock): NormGraph {
  if (block.variant === 'basic' || !block.diagram) return normalizeBasic(block)
  switch (block.diagram.diagram_type) {
    case 'workflow': return normalizeWorkflow(block.diagram)
    case 'architecture': return normalizeArchitecture(block.diagram)
    case 'dataflow': return normalizeDataflow(block.diagram)
    case 'lifecycle': return normalizeLifecycle(block.diagram)
  }
}

function normalizeBasic(block: FlowBlock): NormGraph {
  const nodes: NormNode[] = (block.nodes ?? []).map((node) => ({
    id: node.id,
    label: node.label,
    kind: node.kind,
    shape: 'box',
    details: node.details,
    artifactRefs: node.artifactRefs,
    relatedBlockIds: node.relatedBlockIds,
    metadata: node.metadata,
  }))
  const edges: NormEdge[] = (block.edges ?? []).map((edge, index) => ({
    id: edgeId(edge.id, edge.source, edge.target, index),
    source: edge.source,
    target: edge.target,
    label: edge.label,
    details: edge.details,
  }))
  return { nodes, edges, groups: [], hasRanks: false }
}

type Workflow = Extract<ArchifyDiagram, { diagram_type: 'workflow' }>
type Architecture = Extract<ArchifyDiagram, { diagram_type: 'architecture' }>
type Dataflow = Extract<ArchifyDiagram, { diagram_type: 'dataflow' }>
type Lifecycle = Extract<ArchifyDiagram, { diagram_type: 'lifecycle' }>

function normalizeWorkflow(diagram: Workflow): NormGraph {
  const groups: NormGroup[] = diagram.lanes.map((lane) => ({ id: lane.id, label: lane.label, kind: 'lane' }))
  const nodes: NormNode[] = diagram.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    kind: node.type,
    sublabel: node.sublabel,
    tag: node.tag,
    group: node.lane,
    rank: node.col,
    shape: 'box',
  }))
  const edges: NormEdge[] = diagram.edges.map((edge, index) => ({
    id: edgeId(edge.id, edge.from, edge.to, index),
    source: edge.from,
    target: edge.to,
    label: edge.label,
    role: edge.role,
    variant: edge.variant,
  }))
  return { nodes, edges, groups, hasRanks: true }
}

function normalizeArchitecture(diagram: Architecture): NormGraph {
  const groups: NormGroup[] = []
  const groupOf = new Map<string, string>()
  ;(diagram.boundaries ?? []).forEach((boundary, index) => {
    const id = `boundary-${index}`
    groups.push({ id, label: boundary.label, kind: boundary.kind })
    // A component keeps the first boundary that wraps it; nested boundaries are
    // a pixel-layout concern archify owns, not a semantic one ELK needs.
    for (const member of boundary.wraps) if (!groupOf.has(member)) groupOf.set(member, id)
  })
  let anyRank = false
  const nodes: NormNode[] = diagram.components.map((component) => {
    if (typeof component.col === 'number') anyRank = true
    return {
      id: component.id,
      label: component.label,
      kind: component.type,
      sublabel: component.sublabel,
      tag: component.tag,
      group: groupOf.get(component.id),
      rank: typeof component.col === 'number' ? component.col : undefined,
      shape: 'box',
    }
  })
  const edges: NormEdge[] = (diagram.connections ?? []).map((connection, index) => ({
    id: edgeId(connection.id, connection.from, connection.to, index),
    source: connection.from,
    target: connection.to,
    label: connection.label,
    variant: connection.variant,
  }))
  return { nodes, edges, groups, hasRanks: anyRank }
}

function normalizeDataflow(diagram: Dataflow): NormGraph {
  const groups: NormGroup[] = diagram.stages.map((stage, index) => ({ id: `stage-${index}`, label: stage.label, kind: 'stage' }))
  const nodes: NormNode[] = diagram.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    kind: node.type,
    sublabel: node.sublabel,
    tag: node.tag,
    group: `stage-${node.stage}`,
    rank: node.stage,
    shape: 'box',
  }))
  const edges: NormEdge[] = diagram.flows.map((flow, index) => ({
    id: edgeId(flow.id, flow.from, flow.to, index),
    source: flow.from,
    target: flow.to,
    label: flow.classification ? `${flow.label} · ${flow.classification}` : flow.label,
    variant: flow.variant,
  }))
  return { nodes, edges, groups, hasRanks: true }
}

/** Lifecycle state type → node shape. A decision branches; terminals read as pills. */
function lifecycleShape(type: Lifecycle['states'][number]['type']): NormShape {
  if (type === 'decision') return 'diamond'
  if (type === 'start' || type === 'success' || type === 'failure') return 'pill'
  return 'box'
}

function normalizeLifecycle(diagram: Lifecycle): NormGraph {
  const groups: NormGroup[] = diagram.lanes.map((lane) => ({ id: lane.id, label: lane.label, kind: 'lane' }))
  const nodes: NormNode[] = diagram.states.map((state) => ({
    id: state.id,
    label: state.label,
    // Lifecycle state types carry their own semantic colours (success/failure/…);
    // styles.css maps `.kind-<type>` for these alongside the componentType kinds.
    kind: state.type,
    sublabel: state.sublabel,
    tag: state.tag,
    group: state.lane,
    rank: state.col,
    shape: lifecycleShape(state.type),
  }))
  const edges: NormEdge[] = diagram.transitions.map((transition, index) => ({
    id: edgeId(transition.id, transition.from, transition.to, index),
    source: transition.from,
    target: transition.to,
    label: transition.label,
    variant: transition.variant,
  }))
  return { nodes, edges, groups, hasRanks: true }
}
