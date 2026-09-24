import { z } from 'zod'

/**
 * Archify diagram schemas, translated field-for-field from the archify skill's
 * JSON Schemas (schemas/{common,workflow,architecture,dataflow,lifecycle}.schema.json).
 *
 * Tracebook stores these documents verbatim inside a `flow` block (see
 * `flowBlockSchema`), so an Agent can hand Tracebook a valid archify diagram and
 * the Viewer renders it. Geometry, however, is Tracebook's own: ELK lays the
 * graph out and Vue Flow draws it (AGENTS.md), so archify's pixel/routing hint
 * fields (viewBox, via, channelX/Y, route, fromSide/toSide, label offsets, pos,
 * size, width, brand) are accepted and preserved for round-trip fidelity but
 * ignored at render time. Item schemas are therefore `looseObject` — unknown
 * hint keys survive a parse instead of being stripped.
 */

// --- common.schema.json ---------------------------------------------------

export const archifyId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'archify id must match ^[a-zA-Z][a-zA-Z0-9_-]*$')
export const componentType = z.enum(['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'])
export const archifyVariant = z.enum(['default', 'emphasis', 'security', 'dashed'])
export const archifySide = z.enum(['left', 'right', 'top', 'bottom'])
export const archifyPoint = z.tuple([z.number(), z.number()])
const locale = z.enum(['en', 'zh-CN'])
const animation = z.enum(['trace', 'none'])
const visualPreset = z.enum(['classic', 'signal-flow', 'blueprint', 'editorial'])
const qualityProfile = z.enum(['standard', 'showcase'])
const legendMode = z.enum(['auto', 'all', 'hidden'])
const legendEntry = z.looseObject({ label: z.string().optional(), visible: z.boolean().optional() })

const guidedViews = z.array(z.looseObject({
  id: archifyId,
  label: z.string().min(1),
  focus: z.array(archifyId).min(1),
  note: z.string().optional(),
})).max(5)

const cards = z.array(z.looseObject({
  dot: z.enum(['cyan', 'emerald', 'violet', 'amber', 'rose', 'orange', 'slate']),
  title: z.string().min(1),
  items: z.array(z.string()),
}))

/** Shared meta block; kept loose so per-type extras (engineering_profile, repository, column_fit) round-trip. */
const baseMeta = z.looseObject({
  title: z.string().min(1),
  locale: locale.optional(),
  subtitle: z.string().optional(),
  output: z.string().optional(),
  animation: animation.optional(),
  visual_preset: visualPreset.optional(),
  quality_profile: qualityProfile.optional(),
  views: guidedViews.optional(),
  legend: z.looseObject({
    mode: legendMode.optional(),
    entries: z.record(z.string(), legendEntry).optional(),
  }).optional(),
  viewBox: archifyPoint.optional(),
})

const edgeRole = z.enum(['main', 'branch', 'async', 'return', 'error'])

// --- workflow.schema.json -------------------------------------------------

const workflowLane = z.looseObject({
  id: archifyId,
  label: z.string().min(1),
  variant: z.enum(['normal', 'exception']).optional(),
})

const workflowNode = z.looseObject({
  id: archifyId,
  lane: archifyId,
  col: z.number().int().min(0).max(5),
  type: componentType,
  label: z.string().min(1),
  sublabel: z.string().optional(),
  tag: z.string().optional(),
})

const workflowEdge = z.looseObject({
  id: archifyId.optional(),
  from: archifyId,
  to: archifyId,
  label: z.string().optional(),
  variant: archifyVariant.optional(),
  role: edgeRole.optional(),
})

export const workflowDiagramSchema = z.object({
  schema_version: z.union([z.literal(1), z.literal(2)]),
  diagram_type: z.literal('workflow'),
  meta: baseMeta,
  lanes: z.array(workflowLane).min(1),
  phases: z.array(z.looseObject({
    id: archifyId,
    label: z.string().min(1),
    fromCol: z.number().int().min(0).max(5),
    toCol: z.number().int().min(0).max(5),
    variant: archifyVariant.optional(),
  })).optional(),
  groups: z.array(z.looseObject({
    id: archifyId,
    label: z.string().min(1),
    lane: archifyId,
    fromCol: z.number().int().min(0).max(5),
    toCol: z.number().int().min(0).max(5),
    variant: archifyVariant.optional(),
  })).optional(),
  mainPath: z.array(archifyId).min(2).optional(),
  semanticChecks: z.looseObject({}).optional(),
  nodes: z.array(workflowNode).min(1),
  edges: z.array(workflowEdge),
  cards: cards.optional(),
})

// --- architecture.schema.json ---------------------------------------------

const architectureComponent = z.looseObject({
  id: archifyId,
  type: componentType,
  label: z.string().min(1),
  sublabel: z.string().optional(),
  tag: z.string().optional(),
  row: z.number().int().min(0).optional(),
  col: z.number().int().min(0).optional(),
})

const architectureBoundary = z.looseObject({
  kind: z.enum(['region', 'security-group']),
  label: z.string().min(1),
  wraps: z.array(archifyId).min(1),
  pad: z.number().min(0).optional(),
})

const architectureConnection = z.looseObject({
  id: archifyId.optional(),
  from: archifyId,
  to: archifyId,
  label: z.string().optional(),
  variant: archifyVariant.optional(),
})

export const architectureDiagramSchema = z.object({
  schema_version: z.literal(1),
  diagram_type: z.literal('architecture'),
  meta: baseMeta,
  layout: z.looseObject({ mode: z.enum(['grid']) }).optional(),
  components: z.array(architectureComponent).min(1),
  boundaries: z.array(architectureBoundary).optional(),
  connections: z.array(architectureConnection).optional(),
  cards: cards.optional(),
})

// --- dataflow.schema.json --------------------------------------------------

const dataflowNode = z.looseObject({
  id: archifyId,
  type: componentType,
  label: z.string().min(1),
  stage: z.number().int().min(0),
  row: z.number().int().min(0),
  sublabel: z.string().optional(),
  tag: z.string().optional(),
})

const dataflowFlow = z.looseObject({
  id: archifyId.optional(),
  from: archifyId,
  to: archifyId,
  label: z.string().min(1),
  classification: z.string().optional(),
  variant: archifyVariant.optional(),
})

export const dataflowDiagramSchema = z.object({
  schema_version: z.literal(1),
  diagram_type: z.literal('dataflow'),
  meta: baseMeta,
  stages: z.array(z.looseObject({ label: z.string().min(1) })).min(2).max(5),
  nodes: z.array(dataflowNode).min(2),
  flows: z.array(dataflowFlow),
  cards: cards.optional(),
})

// --- lifecycle.schema.json -------------------------------------------------

export const lifecycleStateType = z.enum(['start', 'active', 'waiting', 'decision', 'success', 'failure', 'neutral', 'external'])

const lifecycleState = z.looseObject({
  id: archifyId,
  type: lifecycleStateType,
  label: z.string().min(1),
  lane: archifyId,
  col: z.number().int().min(0).max(4),
  sublabel: z.string().optional(),
  tag: z.string().optional(),
  step: z.string().optional(),
})

const lifecycleTransition = z.looseObject({
  id: archifyId.optional(),
  from: archifyId,
  to: archifyId,
  label: z.string().optional(),
  note: z.string().optional(),
  variant: archifyVariant.optional(),
})

export const lifecycleDiagramSchema = z.object({
  schema_version: z.literal(1),
  diagram_type: z.literal('lifecycle'),
  meta: baseMeta,
  lanes: z.array(z.looseObject({ id: archifyId, label: z.string().min(1) })).min(1).max(4),
  states: z.array(lifecycleState).min(2),
  transitions: z.array(lifecycleTransition),
  cards: cards.optional(),
})

// --- union + helpers -------------------------------------------------------

export const archifyDiagramSchema = z.discriminatedUnion('diagram_type', [
  workflowDiagramSchema,
  architectureDiagramSchema,
  dataflowDiagramSchema,
  lifecycleDiagramSchema,
])

export type ArchifyDiagram = z.infer<typeof archifyDiagramSchema>
export type ArchifyDiagramType = ArchifyDiagram['diagram_type']

/** The ids of the primary graph elements (workflow/dataflow nodes, architecture components, lifecycle states). */
export function diagramNodeIds(diagram: ArchifyDiagram): string[] {
  switch (diagram.diagram_type) {
    case 'workflow':
    case 'dataflow':
      return diagram.nodes.map((node) => node.id)
    case 'architecture':
      return diagram.components.map((component) => component.id)
    case 'lifecycle':
      return diagram.states.map((state) => state.id)
  }
}

/** Map from node/component/state id to its display label, for compact summaries. */
export function diagramNodeLabels(diagram: ArchifyDiagram): Map<string, string> {
  const entries: Array<[string, string]> = (() => {
    switch (diagram.diagram_type) {
      case 'workflow':
      case 'dataflow':
        return diagram.nodes.map((node) => [node.id, node.label] as [string, string])
      case 'architecture':
        return diagram.components.map((component) => [component.id, component.label] as [string, string])
      case 'lifecycle':
        return diagram.states.map((state) => [state.id, state.label] as [string, string])
    }
  })()
  return new Map(entries)
}

/** Every from/to edge endpoint in the diagram, labelled with a stable handle for error messages. */
export function diagramEdgeEndpoints(diagram: ArchifyDiagram): Array<{ handle: string; from: string; to: string; label?: string }> {
  switch (diagram.diagram_type) {
    case 'workflow':
      return diagram.edges.map((edge, index) => ({ handle: edge.id ?? `edge#${index}`, from: edge.from, to: edge.to, label: edge.label }))
    case 'architecture':
      return (diagram.connections ?? []).map((connection, index) => ({ handle: connection.id ?? `connection#${index}`, from: connection.from, to: connection.to, label: connection.label }))
    case 'dataflow':
      return diagram.flows.map((flow, index) => ({ handle: flow.id ?? `flow#${index}`, from: flow.from, to: flow.to, label: flow.label }))
    case 'lifecycle':
      return diagram.transitions.map((transition, index) => ({ handle: transition.id ?? `transition#${index}`, from: transition.from, to: transition.to, label: transition.label }))
  }
}

/** Node references that are not edge endpoints (architecture boundary wraps, workflow mainPath), for integrity checks. */
export function diagramExtraNodeRefs(diagram: ArchifyDiagram): Array<{ ref: string; where: string }> {
  const refs: Array<{ ref: string; where: string }> = []
  if (diagram.diagram_type === 'architecture') {
    for (const boundary of diagram.boundaries ?? []) {
      for (const ref of boundary.wraps) refs.push({ ref, where: `boundary "${boundary.label}" wraps` })
    }
  }
  if (diagram.diagram_type === 'workflow' && diagram.mainPath) {
    for (const ref of diagram.mainPath) refs.push({ ref, where: 'mainPath' })
  }
  return refs
}
