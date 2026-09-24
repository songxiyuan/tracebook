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
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const props = defineProps<{ block: FlowBlock; artifacts: Artifact[]; caseId?: string }>()
const emit = defineEmits<{ ask: [selection: { type: 'node'; id: string; label?: string }] }>()

// Every variant (basic + archify workflow/architecture/dataflow/lifecycle) is
// flattened to one graph here, so nothing below branches on variant.
const graph = shallowRef<NormGraph>(normalize(props.block))
const nodeById = computed(() => new Map(graph.value.nodes.map((node) => [node.id, node])))

const nodes = shallowRef<Node[]>([])
const edges = shallowRef<Edge[]>([])
const layoutNodes = shallowRef<LaidOutNode[]>([])
const selectedId = ref<string | undefined>(rememberedNodeFor(props.block.id))
const selected = computed(() => nodeById.value.get(selectedId.value ?? ''))

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
} = useVueFlow()

const layoutError = ref<string | undefined>(undefined)
const CANVAS_MIN_HEIGHT = 260
const CANVAS_MAX_HEIGHT = 640
const shellHeight = ref(380)
const OVERVIEW_ZOOM = 0.6
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
  await fitView({ padding: 0.14, minZoom: OVERVIEW_ZOOM })
  overviewMode.value = getViewport().zoom <= OVERVIEW_ZOOM + 0.001
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
    if (near) classes.push(near.has(node.id) ? 'tb-focus' : 'tb-dim')
    else if (term) classes.push((labelById.get(node.id) ?? '').includes(term) ? 'tb-focus' : 'tb-dim')
    node.class = classes.join(' ')
    node.hidden = isHidden
  }
  for (const edge of flowEdges.value) {
    const incident = hover ? (edge.source === hover || edge.target === hover) : false
    edge.class = near ? (incident ? 'tb-focus' : 'tb-dim') : ''
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
  rememberFlowSelection(props.block.id, event.node.id)
}
function clearSelection() {
  selectedId.value = undefined
  rememberFlowSelection(props.block.id, undefined)
}
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
watch([hoveredId, searchTerm, hiddenKinds], applyHighlight)
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
      <label class="tb-search" title="Highlight nodes whose label matches">
        <input v-model="searchTerm" type="search" placeholder="Find node" aria-label="Find node by label" />
      </label>
    </div>

    <div v-if="overviewMode" class="flow-overview" role="status">
      <span>Graph is large — showing an overview.</span>
      <button @click="fitWidth">Fit width</button>
      <button @click="zoomActual">100%</button>
      <button @click="resetFit">Reset</button>
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
        <Background pattern-color="#e2e8f0" :gap="20" />
        <Controls />
        <MiniMap
          v-if="showMinimap"
          pannable
          zoomable
          :width="150"
          :height="98"
          node-color="#94a3b8"
          mask-color="rgba(15,23,42,.08)"
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
    <aside v-if="selected" class="flow-inspector">
      <button aria-label="Close inspector" @click="clearSelection">×</button>
      <span>{{ selected.kind || 'node' }}</span>
      <h3>{{ selected.label }}</h3>
      <p v-if="selected.sublabel">{{ selected.sublabel }}</p>
      <p v-if="selected.details">{{ selected.details }}</p>
      <dl v-if="selected.metadata">
        <div v-for="(value, key) in selected.metadata" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div>
      </dl>
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
      <button
        class="ask-button"
        @click="emit('ask', { type: 'node', id: selected.id, label: selected.label })"
      >Ask about this</button>
    </aside>
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

/* Large-graph affordance. */
.flow-overview {
  position: absolute; z-index: 10; top: 10px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px;
  border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--panel);
  box-shadow: 0 8px 24px rgba(15, 23, 42, .12); color: var(--muted); font: 500 10.5px/1.3 var(--font-mono);
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
  border: 1px solid var(--line); border-radius: var(--r-md); background: rgba(255, 255, 255, .94);
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
</style>






