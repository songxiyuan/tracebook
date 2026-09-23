<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { useRoute } from 'vue-router'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Artifact, FlowBlock } from '../../../../src/core/model'
import { artifactUrl } from '../../api'
import { isImageArtifact } from '../../artifact-kind'
import { rememberedNodeFor, rememberFlowSelection } from '../../selection'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const props = defineProps<{ block: FlowBlock; artifacts: Artifact[]; caseId?: string }>()
const emit = defineEmits<{ ask: [selection: { type: 'node'; id: string; label?: string }] }>()

interface DisplayNode {
  id: string
  position: { x: number; y: number }
  data: { label: string; kind?: string }
  class: string
}
interface DisplayEdge { id: string; source: string; target: string; label?: string; animated: boolean }

const nodes = shallowRef<DisplayNode[]>([])
const edges = shallowRef<DisplayEdge[]>([])
const selectedId = ref<string | undefined>(rememberedNodeFor(props.block.id))
const selected = computed(() => props.block.nodes.find((node) => node.id === selectedId.value))

/**
 * The node's refs resolved against the case's artifacts. The protocol stays the
 * same (`artifactRefs` is already part of the node schema); the Inspector only
 * reads it, so an Agent needs no new field to attach a screenshot to a node.
 */
const selectedArtifacts = computed(() => (selected.value?.artifactRefs ?? []).map((id) => ({
  id,
  artifact: props.artifacts.find((artifact) => artifact.id === id),
})))

// A ref can point at an artifact whose payload this deployment never stored
// (metadata-only), so a failed load falls back to the raw link instead of a
// broken image.
const failedImages = ref<string[]>([])

function showsImage(id: string, artifact: Artifact | undefined) {
  return isImageArtifact(artifact) && !failedImages.value.includes(id)
}

function markImageFailed(id: string) {
  if (!failedImages.value.includes(id)) failedImages.value = [...failedImages.value, id]
}
// Vue Flow owns rendering and interaction; ELK owns layout. These handles only
// drive the viewport (fit / zoom presets) and toggle render-time classes for
// hover and filtering — they never move a node.
const {
  fitView,
  zoomTo,
  setViewport,
  getViewport,
  viewport,
  nodes: flowNodes,
  edges: flowEdges,
} = useVueFlow()
const elk = new ELK()

/** A layout/render failure must show a readable error, not a silent white canvas. */
const layoutError = ref<string | undefined>(undefined)

/** Canvas height bounds; the laid-out graph decides where in between it lands. */
const NODE_WIDTH = 176
const NODE_HEIGHT = 58
const CANVAS_MIN_HEIGHT = 260
const CANVAS_MAX_HEIGHT = 620
const shellHeight = ref(380)

/** The legibility floor the opening fit refuses to zoom below (P0-8). */
const OVERVIEW_ZOOM = 0.6
/** True once a fit would have to shrink past the floor: the graph is overview-only. */
const overviewMode = ref(false)
/** The canvas element, so "Fit width" can measure the space it must fill. */
const canvasEl = ref<HTMLElement>()

const DIRECTIONS = ['TB', 'LR', 'BT', 'RL'] as const
type Direction = (typeof DIRECTIONS)[number]

// P2-15: key the direction preference per case, not just per block id, so two
// cases that reuse the same block id stop overwriting each other. `caseId` is
// the clean discriminator; BlockRenderer does not forward it today (that file
// is out of scope here), so we fall back to the case id already on the route,
// and finally to a weak per-graph namespace when there is no route at all.
const route = useRoute()

function layoutScope(): string {
  if (props.caseId) return props.caseId
  const routeId = route?.params.id
  if (typeof routeId === 'string' && routeId) return routeId
  const first = props.block.nodes[0]?.id ?? 'empty'
  return `n${props.block.nodes.length}:${first}`
}

const directionKey = computed(() => `tracebook:flow-direction:${layoutScope()}:${props.block.id}`)
/** The reader's saved axis for this case + block, or undefined when unset. */
function savedDirection(): Direction | undefined {
  try {
    const saved = window.localStorage.getItem(directionKey.value)
    if (saved && (DIRECTIONS as readonly string[]).includes(saved)) return saved as Direction
  } catch { /* storage may be unavailable */ }
  return undefined
}

/**
 * Choose a layout axis from the graph's shape when the reader has expressed no
 * preference: a long, mostly linear chain reads best left-to-right (the screen
 * is wider than it is tall), while a bushy, branching graph reads best
 * top-to-bottom. ELK still performs the layout; this only picks its direction.
 */
function pickAutoDirection(): Direction {
  const graphNodes = props.block.nodes
  if (graphNodes.length <= 2) return props.block.direction
  const ids = new Set(graphNodes.map((node) => node.id))
  const adjacency = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const node of graphNodes) { adjacency.set(node.id, []); indegree.set(node.id, 0) }
  for (const edge of props.block.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue
    adjacency.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  // Longest-path layering via Kahn's algorithm; a node trapped in a cycle keeps
  // layer 0 instead of hanging the loop.
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
  // Deeper than it is wide reads as a chain: lay it out horizontally.
  return depth > width ? 'LR' : 'TB'
}

const direction = ref<Direction>(savedDirection() ?? pickAutoDirection())
/** An explicit toolbar choice wins over the auto-pick and persists per case. */
function setDirection(next: Direction) {
  direction.value = next
  try { window.localStorage.setItem(directionKey.value, next) } catch { /* storage may be unavailable */ }
  void layout()
}

function layoutOptions(value: FlowBlock['direction']) {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': value,
    'elk.spacing.nodeNode': '32',
    'elk.layered.spacing.nodeNodeBetweenLayers': '56',
    'elk.edgeRouting': 'ORTHOGONAL',
  }
}

async function layout() {
  try {
    // Only lay out edges whose endpoints exist: a stored graph can drift out of
    // sync with its nodes, and a dangling edge otherwise crashes ELK into a
    // blank canvas.
    const nodeIdSet = new Set(props.block.nodes.map((node) => node.id))
    const safeEdges = props.block.edges.filter((edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
    const graph = await elk.layout({
      id: 'root',
      layoutOptions: layoutOptions(direction.value),
      children: props.block.nodes.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
      edges: safeEdges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
    })
    const sourceNodes = new Map(props.block.nodes.map((node) => [node.id, node]))
    const laidOut = graph.children ?? []
    nodes.value = laidOut.map((node) => {
      const source = sourceNodes.get(node.id)!
      return {
        id: node.id,
        position: { x: node.x ?? 0, y: node.y ?? 0 },
        data: { label: source.label, kind: source.kind },
        class: source.kind ? `kind-${source.kind}` : '',
      }
    })
    // The canvas hugs its laid-out content: a wide, shallow flow must not reserve
    // a tall empty box, and a deep flow gets room before it starts panning.
    const contentHeight = laidOut.reduce((tallest, node) => Math.max(tallest, (node.y ?? 0) + NODE_HEIGHT), 0)
    shellHeight.value = Math.min(CANVAS_MAX_HEIGHT, Math.max(CANVAS_MIN_HEIGHT, Math.round(contentHeight) + 128))
    edges.value = safeEdges.map((edge) => ({
      id: edge.id, source: edge.source, target: edge.target, label: edge.label, animated: false,
    }))
    layoutError.value = undefined
    await nextTick()
    // Reapply hover/filter/search classes onto the freshly synced Vue Flow store.
    applyHighlight()
    // Node labels are the payload, so the opening view keeps a legibility floor
    // and lets the reader pan; the minimap and the fit control still overview.
    await runFit()
  } catch (error) {
    layoutError.value = error instanceof Error ? error.message : 'Failed to lay out this flow'
  }
}
/** Fit within the legibility floor, then flag whether the graph is overview-only. */
async function runFit() {
  await fitView({ padding: 0.12, minZoom: OVERVIEW_ZOOM })
  overviewMode.value = getViewport().zoom <= OVERVIEW_ZOOM + 0.001
}

function resetFit() { void runFit() }

/** Content bounding box in graph space, from ELK's laid-out node positions. */
const contentBounds = computed(() => {
  if (!nodes.value.length) return undefined
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes.value) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + NODE_WIDTH)
    maxY = Math.max(maxY, node.position.y + NODE_HEIGHT)
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
})

const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100))

/**
 * Fit the graph's full width into view even if that means zooming past the
 * legibility floor: for a wide chain the reader wants the whole span and can
 * scroll down for the rest.
 */
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

// --- In-graph interaction state (render-time only; positions never change) ---
const hoveredId = ref<string | undefined>(undefined)
const searchTerm = ref('')
const hiddenKinds = ref<Set<string>>(new Set())
const showMinimap = ref(true)

/** Distinct kinds present, in first-seen order; drives the legend and the filter. */
const kinds = computed(() => {
  const seen: string[] = []
  for (const node of props.block.nodes) {
    if (node.kind && !seen.includes(node.kind)) seen.push(node.kind)
  }
  return seen
})
function neighbourIds(id: string): Set<string> {
  const near = new Set<string>([id])
  for (const edge of edges.value) {
    if (edge.source === id) near.add(edge.target)
    else if (edge.target === id) near.add(edge.source)
  }
  return near
}

/**
 * Recompute each node's and edge's render class from the current view state and
 * write it onto the Vue Flow store. We only touch `class`, `hidden` and
 * `animated`; positions and selection stay owned by Vue Flow, so hovering or
 * filtering never disturbs a dragged node or the inspected selection.
 */
function applyHighlight() {
  const hover = hoveredId.value
  const term = searchTerm.value.trim().toLowerCase()
  const hidden = hiddenKinds.value
  const near = hover ? neighbourIds(hover) : undefined
  const kindById = new Map(props.block.nodes.map((node) => [node.id, node.kind]))
  const labelById = new Map(props.block.nodes.map((node) => [node.id, node.label.toLowerCase()]))
  const hiddenIds = new Set<string>()
  for (const node of flowNodes.value) {
    const kind = kindById.get(node.id)
    const isHidden = kind ? hidden.has(kind) : false
    if (isHidden) hiddenIds.add(node.id)
    const classes: string[] = kind ? [`kind-${kind}`] : []
    if (near) classes.push(near.has(node.id) ? 'tb-focus' : 'tb-dim')
    else if (term) classes.push((labelById.get(node.id) ?? '').includes(term) ? 'tb-focus' : 'tb-dim')
    node.class = classes.join(' ')
    node.hidden = isHidden
  }
  for (const edge of flowEdges.value) {
    const incident = hover ? (edge.source === hover || edge.target === hover) : false
    edge.class = near ? (incident ? 'tb-focus' : 'tb-dim') : ''
    edge.animated = incident
    edge.hidden = hiddenIds.has(edge.source) || hiddenIds.has(edge.target)
  }
}

function onNodeEnter(event: { node: { id: string } }) { hoveredId.value = event.node.id }
function onNodeLeave() { hoveredId.value = undefined }

/** Toggle a kind's visibility; the legend chip doubles as the filter control. */
function toggleKind(kind: string) {
  const next = new Set(hiddenKinds.value)
  if (next.has(kind)) next.delete(kind)
  else next.add(kind)
  hiddenKinds.value = next
}

function selectNode(event: { node: { id: string } }) {
  selectedId.value = event.node.id
  rememberFlowSelection(props.block.id, event.node.id)
}

function clearSelection() {
  selectedId.value = undefined
  rememberFlowSelection(props.block.id, undefined)
}
/** Keep the remembered node when a content refresh swaps the block in place. */
function restoreSelection() {
  const remembered = rememberedNodeFor(props.block.id)
  selectedId.value = remembered && props.block.nodes.some((node) => node.id === remembered) ? remembered : undefined
}

onMounted(layout)
watch(() => props.block, async () => {
  restoreSelection()
  // A refreshed graph may have a new shape; re-pick the axis unless the reader
  // pinned one for this case.
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
        <input v-model="searchTerm" type="search" placeholder="Find node" />
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
        :nodes-draggable="true"
        :min-zoom="0.2"
        :max-zoom="2"
        @node-click="selectNode"
        @node-mouse-enter="onNodeEnter"
        @node-mouse-leave="onNodeLeave"
      >
        <template #node-default="{ data }">
          <div class="flow-node" :title="data.label">
            <strong class="node-label">{{ data.label }}</strong>
            <small v-if="data.kind">{{ data.kind }}</small>
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
/* Label legibility (P0-8 / §2.4): one line with an ellipsis so a long label
   never overflows the fixed-width node box. The full text stays reachable via
   the node's native title tooltip and the Inspector. */
.node-label {
  display: block;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* The richer toolbar carries more than the axis buttons, so let it wrap rather
   than run off the canvas edge. */
.flow-toolbar-rich { flex-wrap: wrap; max-width: calc(100% - 20px); row-gap: 3px; }
.tb-sep { width: 1px; align-self: stretch; margin: 2px 3px; padding: 0 !important; background: var(--line); }
.tb-zoom {
  color: var(--muted) !important;
  font-variant-numeric: tabular-nums;
  text-transform: none !important;
  letter-spacing: 0 !important;
}
.tb-search { display: inline-flex; align-items: center; }
.tb-search input {
  width: 94px;
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--panel-2);
  color: var(--ink-strong);
  font: 500 10px/1 var(--font-mono);
}
/* Large-graph affordance: the reader is not stranded at the 0.6 floor. */
.flow-overview {
  position: absolute;
  z-index: 10;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--panel);
  box-shadow: 0 8px 24px rgba(15, 23, 42, .12);
  color: var(--muted);
  font: 500 10.5px/1.3 var(--font-mono);
}
.flow-overview button {
  padding: 3px 7px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--panel-2);
  color: var(--frontend);
  font: 500 10px/1 var(--font-mono);
}
.flow-overview button:hover { border-color: var(--frontend); }

/* Legend doubles as a per-kind filter; each swatch borrows the shared --kind. */
.flow-legend {
  position: absolute;
  z-index: 9;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  max-width: calc(100% - 120px);
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: rgba(255, 255, 255, .94);
}
.flow-legend-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px 2px 5px;
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  background: var(--panel);
  color: var(--muted);
  font: 600 9.5px/1.3 var(--font-mono);
  letter-spacing: .04em;
  text-transform: uppercase;
}
.flow-legend-chip .swatch {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--kind, var(--external));
}
.flow-legend-chip.off { opacity: .45; text-decoration: line-through; }

/* Hover / search emphasis, written by applyHighlight() onto Vue Flow's own node
   and edge elements (hence :deep). ELK still owns geometry; this is only paint. */
.flow-canvas :deep(.vue-flow__node.tb-dim) { opacity: .28; }
.flow-canvas :deep(.vue-flow__node.tb-focus) { opacity: 1; }
.flow-canvas :deep(.vue-flow__edge.tb-dim) { opacity: .14; }
.flow-canvas :deep(.vue-flow__edge.tb-focus .vue-flow__edge-path) {
  stroke: var(--frontend) !important;
  stroke-width: 2 !important;
}

/* A layout failure needs to read as a message, not a stray line of body text. */
.flow-error {
  position: absolute;
  z-index: 11;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  padding: 10px 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--panel);
  color: var(--ink-strong);
  font: 500 11px/1.4 var(--font-mono);
}
</style>


