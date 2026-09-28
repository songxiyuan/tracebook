<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { VueFlow, useVueFlow, MarkerType, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { useRoute } from 'vue-router'
import type { Artifact, FlowBlock } from '../../../../src/core/model'
import { artifactUrl } from '../../api'
import { isImageArtifact } from '../../artifact-kind'
import { rememberedNodeFor, rememberFlowSelection } from '../../selection'
import { normalize, type NormEdge, type NormGraph, type NormNode } from '../../flow/normalize'
import { layoutGraph, type Direction, type GroupBox, type LaidOutNode } from '../../flow/elk-layout'
import OrthogonalEdge from '../../flow/OrthogonalEdge.vue'
import { useTheme } from '../../theme'
import { buildPassport, reachable, type GEdge, type GNode } from '../../diagram/graph-analysis'
import SemanticPassport from '../../diagram/SemanticPassport.vue'
import { blockLink, copyText } from '../../clipboard'
import { buildFlowSvg, type SvgEdge, type SvgGroup, type SvgNode } from '../../flow/flow-to-svg'
import { downloadBlob, downloadSvg, svgToPng } from '../../diagram/diagram-export'
import type { Point } from '../../flow/elk-layout'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const props = defineProps<{ block: FlowBlock; artifacts: Artifact[]; caseId?: string }>()
const emit = defineEmits<{ ask: [selection: { type: 'node'; id: string; label?: string }] }>()

// Every variant (basic + archify workflow/architecture/dataflow/lifecycle) is
// flattened to one graph here, so nothing below branches on variant.
const graph = shallowRef<NormGraph>(normalize(props.block))
const nodeById = computed(() => new Map(graph.value.nodes.map((node) => [node.id, node])))

// Canvas chrome (dot grid, minimap) is drawn as SVG attributes, so it cannot
// inherit CSS tokens — bind it to the resolved theme instead.
const { resolved: theme } = useTheme()
const gridColor = computed(() => (theme.value === 'dark' ? '#24324a' : '#e2e8f0'))
const minimapNode = computed(() => (theme.value === 'dark' ? '#334155' : '#94a3b8'))
const minimapMask = computed(() => (theme.value === 'dark' ? 'rgba(2,6,23,.45)' : 'rgba(15,23,42,.08)'))

const nodes = shallowRef<Node[]>([])
const edges = shallowRef<Edge[]>([])
const layoutNodes = shallowRef<LaidOutNode[]>([])
const groupBoxes = shallowRef<GroupBox[]>([])
const selectedId = ref<string | undefined>(rememberedNodeFor(props.block.id))
const selected = computed(() => nodeById.value.get(selectedId.value ?? ''))

// Semantic-passport graph model: the NormGraph projected to the shared shape.
const graphNodes = computed<GNode[]>(() => graph.value.nodes.map((node) => ({
  id: node.id, label: node.label, kind: node.kind, sublabel: node.sublabel, tag: node.tag,
})))
const graphEdges = computed<GEdge[]>(() => graph.value.edges.map((edge) => ({ source: edge.source, target: edge.target, label: edge.label })))
const passport = computed(() => (selectedId.value ? buildPassport(selectedId.value, graphNodes.value, graphEdges.value) : undefined))

/** Reachability lens: dim everything outside the up/down transitive set of the selection. */
const reachDir = ref<'up' | 'down' | null>(null)
const reachSet = computed(() => {
  if (!reachDir.value || !selectedId.value) return undefined
  const set = reachable(selectedId.value, graphNodes.value, graphEdges.value, reachDir.value)
  set.add(selectedId.value)
  return set
})
const passportCopied = ref(false)

// Guided views ("演示") from the archify diagram meta; absent for basic flows.
const views = computed(() => (props.block.variant !== 'basic' && props.block.diagram?.meta?.views) ? props.block.diagram.meta.views : [])
const presentIndex = ref(-1)
const currentView = computed(() => (presentIndex.value >= 0 ? views.value[presentIndex.value] : undefined))
const presentFocus = computed(() => {
  const view = currentView.value
  if (!view) return undefined
  const ids = new Set(graphNodes.value.map((node) => node.id))
  return new Set(view.focus.filter((id) => ids.has(id)))
})
/** The reachability lens and presentation focus share the dim/emphasis machinery. */
const activeFocus = computed(() => presentFocus.value ?? reachSet.value)

// __REST__

/** Node refs resolved against the case's artifacts (basic-variant nodes only carry refs). */
const selectedArtifacts = computed(() => (selected.value?.artifactRefs ?? []).map((id) => ({
  id,
  artifact: props.artifacts.find((artifact) => artifact.id === id),
})))

const failedImages = ref<string[]>([])
function showsImage(id: string, artifact: Artifact | undefined) {
  return isImageArtifact(artifact) && !failedImages.value.includes(id)
}
function markImageFailed(id: string) {
  if (!failedImages.value.includes(id)) failedImages.value = [...failedImages.value, id]
}

// Vue Flow owns rendering/interaction; ELK owns layout. These handles only drive
// the viewport and toggle render-time classes — they never move a node.
const {
  fitView, zoomTo, setViewport, getViewport, viewport,
  nodes: flowNodes, edges: flowEdges,
  onNodesInitialized,
} = useVueFlow()

// Vue Flow measures node sizes asynchronously; a fit run before that (or before
// the shell finishes resizing to the new content height) frames a stale viewport
// and clips the first row. Re-fit once nodes report real dimensions so the graph
// always opens centred, like the standalone archify export.
onNodesInitialized(() => { void runFit() })

const layoutError = ref<string | undefined>(undefined)
const CANVAS_MIN_HEIGHT = 260
const CANVAS_MAX_HEIGHT = 640
const shellHeight = ref(380)
const OVERVIEW_ZOOM = 0.45
const overviewMode = ref(false)
const canvasEl = ref<HTMLElement>()

/**
 * Edge paint by archify semantics. Concrete hex (not CSS vars) so the arrow
 * marker — drawn in <defs> where var() does not resolve — matches the stroke.
 */
function edgeStyleFor(edge: NormEdge): { color: string; width: number; dash?: string } {
  const { role, variant } = edge
  if (role === 'error' || variant === 'security') return { color: '#be123c', width: 1.9 }
  if (role === 'return') return { color: '#64748b', width: 1.6, dash: '6 5' }
  if (role === 'async') return { color: '#c2410c', width: 1.6, dash: '6 5' }
  if (role === 'main' || variant === 'emphasis') return { color: '#0e7490', width: 2.2 }
  if (variant === 'dashed') return { color: '#94a3b8', width: 1.6, dash: '6 5' }
  return { color: '#cbd5e1', width: 1.6 }
}

// --- direction (auto-pick + per-case persistence) --------------------------
const DIRECTIONS = ['TB', 'LR', 'BT', 'RL'] as const
const route = useRoute()

function layoutScope(): string {
  if (props.caseId) return props.caseId
  const routeId = route?.params.id
  if (typeof routeId === 'string' && routeId) return routeId
  const first = graph.value.nodes[0]?.id ?? 'empty'
  return `n${graph.value.nodes.length}:${first}`
}
const directionKey = computed(() => `tracebook:flow-direction:${layoutScope()}:${props.block.id}`)
function savedDirection(): Direction | undefined {
  try {
    const saved = window.localStorage.getItem(directionKey.value)
    if (saved && (DIRECTIONS as readonly string[]).includes(saved)) return saved as Direction
  } catch { /* storage may be unavailable */ }
  return undefined
}

/** A long linear chain reads best left-to-right; a bushy graph reads top-to-bottom. */
function pickAutoDirection(): Direction {
  const graphNodes = graph.value.nodes
  if (graphNodes.length <= 2) return (props.block.variant === 'basic' ? props.block.direction : 'LR')
  const ids = new Set(graphNodes.map((node) => node.id))
  const adjacency = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const node of graphNodes) { adjacency.set(node.id, []); indegree.set(node.id, 0) }
  for (const edge of graph.value.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue
    adjacency.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const layer = new Map<string, number>(graphNodes.map((node) => [node.id, 0]))
  const pending = new Map(indegree)
  const queue = graphNodes.filter((node) => (pending.get(node.id) ?? 0) === 0).map((node) => node.id)
  while (queue.length) {
    const current = queue.shift()!
    for (const next of adjacency.get(current) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(current) ?? 0) + 1))
      const remaining = (pending.get(next) ?? 0) - 1
      pending.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }
  const perLayer = new Map<number, number>()
  for (const value of layer.values()) perLayer.set(value, (perLayer.get(value) ?? 0) + 1)
  const depth = Math.max(...layer.values()) + 1
  const width = Math.max(...perLayer.values())
  return depth > width ? 'LR' : 'TB'
}

const direction = ref<Direction>(savedDirection() ?? pickAutoDirection())
function setDirection(next: Direction) {
  direction.value = next
  try { window.localStorage.setItem(directionKey.value, next) } catch { /* storage may be unavailable */ }
  void layout()
}

/** Build a background box node for a lane / boundary / stage. */
function groupNode(box: GroupBox): Node {
  return {
    id: `grp:${box.id}`,
    type: 'laneGroup',
    position: { x: box.x, y: box.y },
    data: { label: box.label, kind: box.kind },
    class: `flow-group ${box.kind ? `group-${box.kind}` : ''}`,
    style: { width: `${box.width}px`, height: `${box.height}px` },
    selectable: false,
    draggable: false,
    zIndex: 0,
  }
}

function contentNode(source: NormNode, laidOut: LaidOutNode): Node {
  return {
    id: source.id,
    position: { x: laidOut.x, y: laidOut.y },
    data: { label: source.label, kind: source.kind, sublabel: source.sublabel, tag: source.tag, shape: source.shape },
    class: [source.kind ? `kind-${source.kind}` : '', `shape-${source.shape}`].filter(Boolean).join(' '),
    style: { width: `${laidOut.width}px` },
    zIndex: 1,
  }
}

async function layout() {
  try {
    const current = graph.value
    const result = await layoutGraph(current, direction.value)
    layoutNodes.value = result.nodes
    groupBoxes.value = result.groups
    const positions = new Map(result.nodes.map((node) => [node.id, node]))
    const sources = new Map(current.nodes.map((node) => [node.id, node]))
    const laneNodes = result.groups.map(groupNode)
    const contentNodes = result.nodes
      .map((laidOut) => { const source = sources.get(laidOut.id); return source ? contentNode(source, laidOut) : undefined })
      .filter((node): node is Node => !!node)
    nodes.value = [...laneNodes, ...contentNodes]

    const contentHeight = result.contentHeight
    shellHeight.value = Math.min(CANVAS_MAX_HEIGHT, Math.max(CANVAS_MIN_HEIGHT, Math.round(contentHeight) + 140))

    edges.value = current.edges
      .filter((edge) => positions.has(edge.source) && positions.has(edge.target))
      .map((edge) => {
        const paint = edgeStyleFor(edge)
        const style: Record<string, string | number> = { stroke: paint.color, strokeWidth: paint.width }
        if (paint.dash) style.strokeDasharray = paint.dash
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          type: 'orthogonal',
          data: { points: result.routes.get(edge.id) },
          markerEnd: { type: MarkerType.ArrowClosed, color: paint.color, width: 15, height: 15 },
          style,
          class: '',
        }
      })
    layoutError.value = undefined
    await nextTick()
    applyHighlight()
    await runFit()
  } catch (error) {
    layoutError.value = error instanceof Error ? error.message : 'Failed to lay out this flow'
  }
}

async function runFit() {
  // Fit the whole graph with no artificial zoom floor, so a wide LR graph always
  // opens fully framed instead of being clamped and pushed off-canvas. The
  // overview hint only appears for a genuinely tiny fit (very large graphs).
  await fitView({ padding: 0.14, minZoom: 0.1 })
  overviewMode.value = getViewport().zoom < OVERVIEW_ZOOM - 0.001
}
function resetFit() { void runFit() }

/** Content bounding box from ELK's laid-out content nodes (groups excluded). */
const contentBounds = computed(() => {
  if (!layoutNodes.value.length) return undefined
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const node of layoutNodes.value) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
})

const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100))

function fitWidth() {
  const bounds = contentBounds.value
  const el = canvasEl.value
  if (!bounds || !el || bounds.width <= 0) { void runFit(); return }
  const inset = 0.06
  const usable = el.clientWidth * (1 - inset * 2)
  const zoom = Math.min(2, Math.max(0.2, usable / bounds.width))
  const x = (el.clientWidth - bounds.width * zoom) / 2 - bounds.minX * zoom
  const y = 28 - bounds.minY * zoom
  void setViewport({ x, y, zoom })
  overviewMode.value = zoom < OVERVIEW_ZOOM - 0.001
}
function zoomActual() { void zoomTo(1) }

// --- in-graph interaction (render-time only; positions never change) --------
const hoveredId = ref<string | undefined>(undefined)
const searchTerm = ref('')
const hiddenKinds = ref<Set<string>>(new Set())
const showMinimap = ref(true)

/** Distinct node kinds present, in first-seen order; drives the legend + filter. */
const kinds = computed(() => {
  const seen: string[] = []
  for (const node of graph.value.nodes) {
    if (node.kind && !seen.includes(node.kind)) seen.push(node.kind)
  }
  return seen
})
function neighbourIds(id: string): Set<string> {
  const near = new Set<string>([id])
  for (const edge of graph.value.edges) {
    if (edge.source === id) near.add(edge.target)
    else if (edge.target === id) near.add(edge.source)
  }
  return near
}

/**
 * Recompute each node's/edge's render class from the current view state. Only
 * `class` and `hidden` are touched — never position, and never `animated` (the
 * old marching-ants dashes are gone; hover now reads as colour + weight via CSS).
 * Group background boxes (grp:*) are left alone.
 */
function applyHighlight() {
  const hover = hoveredId.value
  const term = searchTerm.value.trim().toLowerCase()
  const hidden = hiddenKinds.value
  const near = hover ? neighbourIds(hover) : undefined
  const reach = activeFocus.value
  const kindById = new Map(graph.value.nodes.map((node) => [node.id, node.kind]))
  const labelById = new Map(graph.value.nodes.map((node) => [node.id, node.label.toLowerCase()]))
  const hiddenIds = new Set<string>()
  for (const node of flowNodes.value) {
    if (node.id.startsWith('grp:')) continue
    const kind = kindById.get(node.id)
    const isHidden = kind ? hidden.has(kind) : false
    if (isHidden) hiddenIds.add(node.id)
    const classes: string[] = []
    if (kind) classes.push(`kind-${kind}`)
    const shape = (node.data as { shape?: string })?.shape
    if (shape) classes.push(`shape-${shape}`)
    // Reachability lens wins over hover/search when active.
    if (reach) classes.push(reach.has(node.id) ? 'tb-focus' : 'tb-dim')
    else if (near) classes.push(near.has(node.id) ? 'tb-focus' : 'tb-dim')
    else if (term) classes.push((labelById.get(node.id) ?? '').includes(term) ? 'tb-focus' : 'tb-dim')
    node.class = classes.join(' ')
    node.hidden = isHidden
  }
  for (const edge of flowEdges.value) {
    if (reach) edge.class = (reach.has(edge.source) && reach.has(edge.target)) ? 'tb-focus' : 'tb-dim'
    else {
      const incident = hover ? (edge.source === hover || edge.target === hover) : false
      edge.class = near ? (incident ? 'tb-focus' : 'tb-dim') : ''
    }
    edge.hidden = hiddenIds.has(edge.source) || hiddenIds.has(edge.target)
  }
}

function onNodeEnter(event: { node: { id: string } }) {
  if (!event.node.id.startsWith('grp:')) hoveredId.value = event.node.id
}
function onNodeLeave() { hoveredId.value = undefined }

function toggleKind(kind: string) {
  const next = new Set(hiddenKinds.value)
  if (next.has(kind)) next.delete(kind)
  else next.add(kind)
  hiddenKinds.value = next
}

function selectNode(event: { node: { id: string } }) {
  if (event.node.id.startsWith('grp:')) return
  selectedId.value = event.node.id
  reachDir.value = null
  rememberFlowSelection(props.block.id, event.node.id)
  // Frame the selection so a passport for an off-screen node still shows it.
  void fitView({ nodes: [event.node.id], padding: 0.6, maxZoom: 1.4, duration: 320 })
}
function clearSelection() {
  selectedId.value = undefined
  reachDir.value = null
  rememberFlowSelection(props.block.id, undefined)
}
function focusNeighbor(id: string) { selectNode({ node: { id } }) }
function setReach(dir: 'up' | 'down' | null) { reachDir.value = dir }
async function copyPassportLink() {
  if (await copyText(blockLink(props.block.id))) {
    passportCopied.value = true
    setTimeout(() => { passportCopied.value = false }, 1500)
  }
}

function exportName(): string {
  return (props.block.title || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'flow'
}
/** Redraw the ELK geometry as a standalone SVG (Vue Flow's HTML nodes can't be serialized). */
function buildExportSvg(): { svg: string; width: number; height: number } {
  const nodesById = new Map(graph.value.nodes.map((node) => [node.id, node]))
  const pad = 24
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const consider = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h)
  }
  for (const node of layoutNodes.value) consider(node.x, node.y, node.width, node.height)
  for (const box of groupBoxes.value) consider(box.x, box.y, box.width, box.height)
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100 }
  const dx = pad - minX
  const dy = pad - minY
  const width = (maxX - minX) + pad * 2
  const height = (maxY - minY) + pad * 2
  const svgNodes: SvgNode[] = layoutNodes.value.map((node) => {
    const source = nodesById.get(node.id)
    return { x: node.x + dx, y: node.y + dy, w: node.width, h: node.height, label: source?.label ?? node.id, sublabel: source?.sublabel, kind: source?.kind, shape: source?.shape ?? 'box' }
  })
  const svgGroups: SvgGroup[] = groupBoxes.value.map((box) => ({ x: box.x + dx, y: box.y + dy, w: box.width, h: box.height, label: box.label }))
  const svgEdges: SvgEdge[] = edges.value
    .filter((edge) => (edge.data as { points?: Point[] })?.points?.length)
    .map((edge) => {
      const points = ((edge.data as { points: Point[] }).points).map((point) => ({ x: point.x + dx, y: point.y + dy }))
      const style = (edge.style ?? {}) as { stroke?: string; strokeWidth?: number; strokeDasharray?: string }
      return { points, color: style.stroke ?? '#cbd5e1', width: Number(style.strokeWidth ?? 1.6), dash: style.strokeDasharray }
    })
  return { svg: buildFlowSvg({ width, height, nodes: svgNodes, edges: svgEdges, groups: svgGroups }), width, height }
}
function exportSvg() { downloadSvg(`${exportName()}.svg`, buildExportSvg().svg) }
async function exportPng() {
  const { svg, width, height } = buildExportSvg()
  downloadBlob(`${exportName()}.png`, await svgToPng(svg, width, height, 2))
}

/** Step through the diagram's guided views, framing and focusing each chapter. */
function goView() {
  const focus = presentFocus.value
  if (focus && focus.size) void fitView({ nodes: [...focus], padding: 0.4, maxZoom: 1.6, duration: 320 })
  applyHighlight()
}
function startPresent() { selectedId.value = undefined; reachDir.value = null; presentIndex.value = 0; void nextTick().then(goView) }
function exitPresent() { presentIndex.value = -1; void nextTick().then(() => { applyHighlight(); void runFit() }) }
function nextView() { if (presentIndex.value < views.value.length - 1) { presentIndex.value += 1; goView() } }
function prevView() { if (presentIndex.value > 0) { presentIndex.value -= 1; goView() } }
function restoreSelection() {
  const remembered = rememberedNodeFor(props.block.id)
  selectedId.value = remembered && nodeById.value.has(remembered) ? remembered : undefined
}

onMounted(layout)
watch(() => props.block, async () => {
  graph.value = normalize(props.block)
  restoreSelection()
  if (!savedDirection()) direction.value = pickAutoDirection()
  await layout()
}, { deep: true })
watch(selectedId, () => { failedImages.value = [] })
watch([hoveredId, searchTerm, hiddenKinds, reachDir, presentIndex], applyHighlight)
</script>

<template>
  <div class="flow-shell" :class="{ inspecting: selected }" :style="{ height: `${shellHeight}px` }">
    <div class="flow-toolbar flow-toolbar-rich">
      <span>Layout</span>
      <button
        v-for="option in DIRECTIONS"
        :key="option"
        :class="{ active: direction === option }"
        :title="`Lay the flow out ${option}`"
        @click="setDirection(option)"
      >{{ option }}</button>
      <span class="tb-sep" aria-hidden="true"></span>
      <button title="Fit the whole graph within the legibility floor" @click="resetFit">Fit</button>
      <button title="Fit the full width; scroll for the height" @click="fitWidth">Fit width</button>
      <button title="Zoom to 100%" @click="zoomActual">100%</button>
      <span class="tb-zoom" :title="`Current zoom ${zoomPercent}%`">{{ zoomPercent }}%</span>
      <span class="tb-sep" aria-hidden="true"></span>
      <button :class="{ active: showMinimap }" title="Show or hide the minimap" @click="showMinimap = !showMinimap">Map</button>
      <span class="tb-sep" aria-hidden="true"></span>
      <button title="导出 SVG" @click="exportSvg">SVG</button>
      <button title="导出 PNG" @click="exportPng">PNG</button>
      <button v-if="views.length" title="按引导视图逐步演示" @click="startPresent">演示</button>
      <label class="tb-search" title="Highlight nodes whose label matches">
        <input v-model="searchTerm" type="search" placeholder="Find node" aria-label="Find node by label" />
      </label>
    </div>

    <div v-if="currentView" class="flow-present" role="status">
      <button class="present-nav" :disabled="presentIndex <= 0" title="上一步" @click="prevView">‹</button>
      <div class="present-body">
        <strong>{{ currentView.label }}</strong>
        <small v-if="currentView.note">{{ currentView.note }}</small>
      </div>
      <span class="present-count">{{ presentIndex + 1 }}/{{ views.length }}</span>
      <button class="present-nav" :disabled="presentIndex >= views.length - 1" title="下一步" @click="nextView">›</button>
      <button class="present-exit" title="退出演示" @click="exitPresent">×</button>
    </div>

    <div v-if="overviewMode" class="flow-overview" role="status">
      <span>图较大 · 已缩略</span>
      <button @click="fitWidth">Fit width</button>
      <button @click="zoomActual">100%</button>
    </div>
    <div ref="canvasEl" class="flow-canvas">
      <p v-if="layoutError" class="flow-error" role="alert">Flow layout failed: {{ layoutError }}</p>
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :nodes-draggable="false"
        :min-zoom="0.2"
        :max-zoom="2"
        @node-click="selectNode"
        @node-mouse-enter="onNodeEnter"
        @node-mouse-leave="onNodeLeave"
      >
        <template #edge-orthogonal="edgeProps">
          <OrthogonalEdge v-bind="edgeProps" />
        </template>
        <template #node-laneGroup="{ data }">
          <div class="flow-group-box">
            <span class="flow-group-label">{{ data.label }}</span>
          </div>
        </template>
        <template #node-default="{ id, data }">
          <div
            class="flow-node"
            :title="data.label"
            tabindex="0"
            role="button"
            @keydown.enter.prevent="selectNode({ node: { id } })"
            @keydown.space.prevent="selectNode({ node: { id } })"
            @focus="hoveredId = id"
            @blur="hoveredId = undefined"
          >
            <strong class="node-label">{{ data.label }}</strong>
            <small v-if="data.sublabel" class="node-sublabel">{{ data.sublabel }}</small>
            <small v-else-if="data.kind" class="node-kind">{{ data.kind }}</small>
            <em v-if="data.tag" class="node-tag">{{ data.tag }}</em>
          </div>
        </template>
        <Background :pattern-color="gridColor" :gap="20" />
        <Controls />
        <MiniMap
          v-if="showMinimap"
          pannable
          zoomable
          :width="150"
          :height="98"
          :node-color="minimapNode"
          :mask-color="minimapMask"
        />
      </VueFlow>
      <div v-if="kinds.length" class="flow-legend">
        <button
          v-for="kind in kinds"
          :key="kind"
          class="flow-legend-chip"
          :class="[`kind-${kind}`, { off: hiddenKinds.has(kind) }]"
          :title="hiddenKinds.has(kind) ? `Show ${kind} nodes` : `Hide ${kind} nodes`"
          @click="toggleKind(kind)"
        ><i class="swatch" aria-hidden="true"></i>{{ kind }}</button>
      </div>
    </div>
    <SemanticPassport
      v-if="passport"
      class="flow-passport"
      :passport="passport"
      :reach-dir="reachDir"
      :copied="passportCopied"
      @close="clearSelection"
      @copy="copyPassportLink"
      @focus="focusNeighbor"
      @reach="setReach"
    >
      <template #actions>
        <button
          class="passport-ask"
          @click="selected && emit('ask', { type: 'node', id: selected.id, label: selected.label })"
        >追问</button>
      </template>
    </SemanticPassport>
    <div v-if="selected && (selected.details || selected.artifactRefs?.length || selected.relatedBlockIds?.length)" class="flow-extra">
      <p v-if="selected.details" class="flow-extra-details">{{ selected.details }}</p>
      <div v-if="selected.relatedBlockIds?.length" class="inspector-links">
        <strong>Related blocks</strong>
        <a v-for="id in selected.relatedBlockIds" :key="id" :href="`#block-${id}`">{{ id }}</a>
      </div>
      <div v-if="selected.artifactRefs?.length" class="inspector-links">
        <strong>Artifacts</strong>
        <template v-for="entry in selectedArtifacts" :key="entry.id">
          <figure v-if="showsImage(entry.id, entry.artifact)" class="inspector-shot">
            <a :href="artifactUrl(entry.id)" target="_blank">
              <img
                :src="artifactUrl(entry.id)"
                :alt="entry.artifact?.name || entry.id"
                loading="lazy"
                @error="markImageFailed(entry.id)"
              />
            </a>
            <figcaption>{{ entry.artifact?.name || entry.id }} ↗</figcaption>
          </figure>
          <a v-else :href="artifactUrl(entry.id)" target="_blank">{{ entry.id }} ↗</a>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* One-line label with ellipsis; full text stays in the tooltip + Inspector. */
.node-label { display: block; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.node-sublabel { display: block; margin-top: 2px; color: var(--muted); font: 400 9.5px/1.3 var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-kind { display: block; margin-top: 2px; color: var(--muted); font: 500 9px/1.2 var(--font-mono); text-transform: uppercase; letter-spacing: .04em; }
.node-tag {
  position: absolute; top: -8px; right: -6px;
  padding: 1px 6px; border: 1px solid var(--kind, var(--line-strong));
  border-radius: var(--r-pill); background: var(--panel);
  color: var(--kind, var(--muted)); font: 600 8.5px/1.4 var(--font-mono);
  font-style: normal; letter-spacing: .03em;
}

/* Shapes: a decision branches (diamond), terminals read as pills. */
.flow-canvas :deep(.shape-pill .flow-node) { border-radius: var(--r-pill); }
.flow-canvas :deep(.shape-diamond .flow-node) {
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  padding: 18px 26px; text-align: center;
}

/* Lane / boundary / stage background box, sized by ELK from its members. */
.flow-canvas :deep(.flow-group .vue-flow__node-laneGroup),
.flow-group-box { width: 100%; height: 100%; }
.flow-group-box {
  box-sizing: border-box;
  border: 1px dashed color-mix(in srgb, var(--line-strong) 70%, transparent);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--panel-2) 55%, transparent);
}
.flow-canvas :deep(.group-region .flow-group-box) { border-style: solid; }
.flow-canvas :deep(.group-security-group .flow-group-box) {
  border-color: color-mix(in srgb, var(--security) 45%, var(--line-strong));
  background: color-mix(in srgb, var(--security) 6%, transparent);
}
.flow-group-label {
  position: absolute; top: 4px; left: 8px;
  color: var(--muted); font: 600 9.5px/1.4 var(--font-mono);
  letter-spacing: .05em; text-transform: uppercase;
}

/* Toolbar extras. */
.flow-toolbar-rich { flex-wrap: wrap; max-width: calc(100% - 20px); row-gap: 3px; }
.tb-sep { width: 1px; align-self: stretch; margin: 2px 3px; padding: 0 !important; background: var(--line); }
.tb-zoom { color: var(--muted) !important; font-variant-numeric: tabular-nums; text-transform: none !important; letter-spacing: 0 !important; }
.tb-search { display: inline-flex; align-items: center; }
.tb-search input {
  width: 94px; padding: 3px 6px; border: 1px solid var(--line);
  border-radius: var(--r-sm); background: var(--panel-2);
  color: var(--ink-strong); font: 500 10px/1 var(--font-mono);
}

/* Large-graph affordance: a compact chip docked bottom-right, out of the toolbar. */
.flow-overview {
  position: absolute; z-index: 10; bottom: 10px; right: 10px;
  display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px;
  border: 1px solid var(--line-strong); border-radius: var(--r-pill); background: color-mix(in srgb, var(--panel) 96%, transparent);
  box-shadow: 0 8px 24px rgba(15, 23, 42, .12); color: var(--muted); font: 500 10px/1.3 var(--font-mono);
}
.flow-overview button {
  padding: 3px 7px; border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--panel-2); color: var(--frontend); font: 500 10px/1 var(--font-mono);
}
.flow-overview button:hover { border-color: var(--frontend); }

/* Legend doubles as a per-kind filter. */
.flow-legend {
  position: absolute; z-index: 9; bottom: 10px; left: 50%; transform: translateX(-50%);
  display: flex; flex-wrap: wrap; justify-content: center; gap: 4px;
  max-width: calc(100% - 120px); padding: 4px 6px;
  border: 1px solid var(--line); border-radius: var(--r-md); background: color-mix(in srgb, var(--panel) 94%, transparent);
}
.flow-legend-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px 2px 5px;
  border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--panel);
  color: var(--muted); font: 600 9.5px/1.3 var(--font-mono); letter-spacing: .04em; text-transform: uppercase;
}
.flow-legend-chip .swatch { width: 9px; height: 9px; border-radius: 2px; background: var(--kind, var(--external)); }
.flow-legend-chip.off { opacity: .45; text-decoration: line-through; }

/* Hover / search emphasis, painted onto Vue Flow's own elements. */
.flow-canvas :deep(.vue-flow__node.tb-dim) { opacity: .26; }
.flow-canvas :deep(.vue-flow__node.tb-focus) { opacity: 1; }
.flow-canvas :deep(.vue-flow__edge.tb-dim) { opacity: .12; }
.flow-canvas :deep(.vue-flow__edge.tb-focus .vue-flow__edge-path) { stroke: var(--frontend) !important; stroke-width: 2.4 !important; }

.flow-error {
  position: absolute; z-index: 11; top: 50%; left: 50%; transform: translate(-50%, -50%);
  margin: 0; padding: 10px 14px; border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--panel); color: var(--ink-strong); font: 500 11px/1.4 var(--font-mono);
}

/* Semantic passport overlays the top-left of the canvas (archify-style). */
.flow-passport { position: absolute; z-index: 12; top: 10px; left: 10px; }
.passport-ask {
  padding: 2px 10px; border: 1px solid var(--frontend); border-radius: var(--r-pill);
  background: color-mix(in srgb, var(--frontend) 10%, var(--panel)); color: var(--frontend);
  font: 600 10px/1.6 var(--font-mono); cursor: pointer;
}
/* Node extras (details / artifacts / related) dock bottom-left, below the passport. */
.flow-extra {
  position: absolute; z-index: 11; bottom: 10px; left: 10px;
  width: min(320px, calc(100% - 24px)); max-height: 46%; overflow: auto;
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-md);
  background: color-mix(in srgb, var(--panel) 96%, transparent);
}
.flow-extra-details { margin: 0; color: var(--ink); font: 400 11.5px/1.5 var(--font-sans); }

/* Guided-view presentation bar. */
.flow-present {
  position: absolute; z-index: 13; top: 46px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; max-width: calc(100% - 40px);
  padding: 5px 8px 5px 6px; border: 1px solid var(--frontend); border-radius: var(--r-pill);
  background: color-mix(in srgb, var(--panel) 96%, transparent);
  box-shadow: 0 10px 28px rgba(2, 6, 23, .16);
}
.flow-present .present-body { display: flex; flex-direction: column; min-width: 0; }
.flow-present .present-body strong { font: 600 11.5px/1.3 var(--font-sans); color: var(--ink-strong); }
.flow-present .present-body small { color: var(--muted); font: 500 9.5px/1.3 var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.flow-present .present-count { color: var(--muted); font: 600 10px/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.present-nav, .present-exit {
  width: 22px; height: 22px; border: 1px solid var(--line); border-radius: var(--r-pill);
  background: var(--panel-2); color: var(--frontend); font: 600 12px/1 var(--font-mono); cursor: pointer;
}
.present-nav:disabled { opacity: .4; cursor: default; }
.present-exit { color: var(--muted); }
</style>







