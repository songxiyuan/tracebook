<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Artifact, FlowBlock } from '../../../../src/core/model'
import { artifactUrl } from '../../api'
import { rememberedNodeFor, rememberFlowSelection } from '../../selection'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const props = defineProps<{ block: FlowBlock; artifacts: Artifact[] }>()
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
const { fitView } = useVueFlow()
const elk = new ELK()

/** Canvas height bounds; the laid-out graph decides where in between it lands. */
const NODE_WIDTH = 176
const NODE_HEIGHT = 58
const CANVAS_MIN_HEIGHT = 260
const CANVAS_MAX_HEIGHT = 620
const shellHeight = ref(380)

const DIRECTIONS = ['TB', 'LR', 'BT', 'RL'] as const
type Direction = (typeof DIRECTIONS)[number]
const directionKey = `tracebook:flow-direction:${props.block.id}`

function readDirection(): Direction {
  try {
    const saved = window.localStorage.getItem(directionKey)
    if (saved && (DIRECTIONS as readonly string[]).includes(saved)) return saved as Direction
  } catch { /* storage may be unavailable */ }
  return props.block.direction
}

const direction = ref<Direction>(readDirection())

function setDirection(next: Direction) {
  direction.value = next
  try { window.localStorage.setItem(directionKey, next) } catch { /* storage may be unavailable */ }
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
  const graph = await elk.layout({
    id: 'root',
    layoutOptions: layoutOptions(direction.value),
    children: props.block.nodes.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: props.block.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
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
  edges.value = props.block.edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, label: edge.label, animated: false,
  }))
  await nextTick()
  // Node labels are the payload, so the opening view keeps a legibility floor and
  // lets the reader pan; the minimap and the fit control still give the overview.
  fitView({ padding: 0.12, minZoom: 0.6 })
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
watch(() => props.block, async () => { restoreSelection(); await layout() }, { deep: true })
watch(direction, layout)
</script>

<template>
  <div class="flow-shell" :class="{ inspecting: selected }" :style="{ height: `${shellHeight}px` }">
    <div class="flow-toolbar">
      <span>Layout</span>
      <button
        v-for="option in DIRECTIONS"
        :key="option"
        :class="{ active: direction === option }"
        :title="`Lay the flow out ${option}`"
        @click="setDirection(option)"
      >{{ option }}</button>
    </div>
    <div class="flow-canvas">
      <VueFlow :nodes="nodes" :edges="edges" :nodes-draggable="true" :min-zoom="0.2" :max-zoom="2" fit-view-on-init @node-click="selectNode">
        <template #node-default="{ data }">
          <div class="flow-node">
            <strong>{{ data.label }}</strong>
            <small v-if="data.kind">{{ data.kind }}</small>
          </div>
        </template>
        <Background pattern-color="#1e293b" :gap="20" />
        <Controls />
        <MiniMap pannable zoomable :width="150" :height="98" node-color="#334155" mask-color="rgba(2,6,23,.72)" />
      </VueFlow>
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
        <a v-for="id in selected.artifactRefs" :key="id" :href="artifactUrl(id)" target="_blank">{{ id }} ↗</a>
      </div>
      <button
        class="ask-button"
        @click="emit('ask', { type: 'node', id: selected.id, label: selected.label })"
      >Ask about this</button>
    </aside>
  </div>
</template>
