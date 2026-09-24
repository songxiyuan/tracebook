<script setup lang="ts">
import { computed } from 'vue'
import type { Artifact, SequenceBlock } from '../../../../src/core/model'

const props = defineProps<{ block: SequenceBlock; artifacts: Artifact[] }>()
const emit = defineEmits<{ ask: [selection: { type: 'node'; id: string; label?: string }] }>()

type Variant = 'default' | 'emphasis' | 'security' | 'dashed' | 'return'
interface Participant { id: string; label: string; kind?: string; sublabel?: string }
interface Message { id: string; from: string; to: string; label: string; variant: Variant; note?: string; open: boolean }
interface Activation { participant: string; fromRow: number; toRow: number }
interface Model { participants: Participant[]; messages: Message[]; activations: Activation[] }

/**
 * Both sequence variants flatten to one row-indexed model. The archify variant
 * carries pixel `y`s (used only to order messages here — ELK-free, we relayout
 * with our own row pitch) and optional activation bars; the basic variant maps
 * its sync/async/stream kinds onto the archify variant vocabulary so a single
 * renderer draws both.
 */
const model = computed<Model>(() => {
  const block = props.block
  if (block.variant === 'archify' && block.diagram) {
    const diagram = block.diagram
    const participants = diagram.participants.map((participant) => ({
      id: participant.id,
      label: participant.label,
      kind: participant.type,
      sublabel: typeof participant.sublabel === 'string' ? participant.sublabel : undefined,
    }))
    const ordered = diagram.messages
      .map((message, index) => ({ message, index }))
      .sort((a, b) => (a.message.y - b.message.y) || (a.index - b.index))
    const sortedY = ordered.map((entry) => entry.message.y)
    const rowForY = (y: number) => {
      let row = 0
      for (const value of sortedY) { if (value <= y) row += 1; else break }
      return Math.max(0, row - 1)
    }
    const messages: Message[] = ordered.map((entry, row) => {
      const variant = (entry.message.variant ?? 'default') as Variant
      return {
        id: entry.message.id ?? `m${row}`,
        from: entry.message.from,
        to: entry.message.to,
        label: entry.message.label,
        variant,
        note: typeof entry.message.note === 'string' ? entry.message.note : undefined,
        open: variant === 'return',
      }
    })
    const activations: Activation[] = (diagram.activations ?? []).map((activation) => ({
      participant: activation.participant,
      fromRow: rowForY(activation.from),
      toRow: rowForY(activation.to),
    }))
    return { participants, messages, activations }
  }
  const participants = (block.participants ?? []).map((participant) => ({
    id: participant.id,
    label: participant.label,
    kind: participant.kind,
  }))
  const messages: Message[] = (block.messages ?? []).map((message, index) => {
    const variant: Variant = message.kind === 'stream' ? 'return' : message.kind === 'async' ? 'dashed' : 'default'
    const meta = [
      message.status !== undefined ? String(message.status) : undefined,
      message.durationMs !== undefined ? `${message.durationMs}ms` : undefined,
      message.timingSource,
    ].filter((part): part is string => part !== undefined)
    return {
      id: message.id ?? `m${index}`,
      from: message.from,
      to: message.to,
      label: message.label,
      variant,
      note: message.note ?? (meta.length ? meta.join(' · ') : undefined),
      open: message.kind !== 'sync',
    }
  })
  return { participants, messages, activations: [] }
})

// __SEQ_LAYOUT__

const MARGIN_X = 34
const HEAD_W = 150
const HEAD_H = 54
const HEAD_TOP = 14
const LIFELINE_TOP = 76
const ROW_TOP = 112
const ROW_H = 58
const COL_W = 196
const SELF_W = 52
const SELF_H = 24

const participants = computed(() => model.value.participants)
const rows = computed(() => model.value.messages.length)

function participantCx(index: number): number {
  return MARGIN_X + HEAD_W / 2 + index * COL_W
}
const participantX = computed(() => new Map(participants.value.map((participant, index) => [participant.id, participantCx(index)])))

const width = computed(() => MARGIN_X * 2 + HEAD_W + Math.max(0, participants.value.length - 1) * COL_W)
const lifelineBottom = computed(() => ROW_TOP + Math.max(0, rows.value - 1) * ROW_H + 34)
const height = computed(() => lifelineBottom.value + 18)

interface LaidMessage extends Message { x1: number; x2: number; y: number; labelX: number; self: boolean }
const laidMessages = computed<LaidMessage[]>(() => {
  const xById = participantX.value
  const fallback = participantCx(0)
  return model.value.messages.map((message, index) => {
    const x1 = xById.get(message.from) ?? fallback
    const x2 = xById.get(message.to) ?? fallback
    const self = message.from === message.to
    const y = ROW_TOP + index * ROW_H
    return { ...message, x1, x2, y, self, labelX: self ? x1 + SELF_W / 2 : (x1 + x2) / 2 }
  })
})

interface LaidActivation { x: number; y: number; height: number; kind?: string }
const laidActivations = computed<LaidActivation[]>(() => {
  const xById = participantX.value
  const kindById = new Map(participants.value.map((participant) => [participant.id, participant.kind]))
  return model.value.activations
    .map((activation): LaidActivation | undefined => {
      const cx = xById.get(activation.participant)
      if (cx === undefined) return undefined
      const top = ROW_TOP + activation.fromRow * ROW_H
      const bottom = ROW_TOP + activation.toRow * ROW_H
      return { x: cx - 5, y: top, height: Math.max(ROW_H / 2, bottom - top), kind: kindById.get(activation.participant) }
    })
    .filter((value): value is LaidActivation => value !== undefined)
})

function loopPath(message: LaidMessage): string {
  return `M ${message.x1} ${message.y - SELF_H / 2} h ${SELF_W} v ${SELF_H} h ${-SELF_W}`
}

const empty = computed(() => !participants.value.length || !rows.value)
const title = computed(() => (props.block.variant === 'archify' ? props.block.diagram?.meta?.title : undefined))

function askParticipant(participant: Participant) {
  emit('ask', { type: 'node', id: participant.id, label: participant.label })
}
</script>

<template>
  <div class="seq-shell">
    <p v-if="empty" class="seq-empty">This sequence has no messages to display yet.</p>
    <div v-else class="seq-scroll">
      <svg class="seq-svg" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="title || 'Sequence diagram'">
        <defs>
          <marker id="seq-solid" markerWidth="12" markerHeight="12" refX="8.5" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" class="seq-marker-solid" />
          </marker>
          <marker id="seq-open" markerWidth="12" markerHeight="12" refX="8.5" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10" class="seq-marker-open" />
          </marker>
        </defs>

        <!-- Participants: colored head + lifeline dropping from it. -->
        <g v-for="(participant, index) in participants" :key="participant.id" class="seq-part" :class="participant.kind ? `kind-${participant.kind}` : ''">
          <line class="seq-lifeline" :x1="participantCx(index)" :y1="LIFELINE_TOP" :x2="participantCx(index)" :y2="lifelineBottom" />
        </g>

        <!-- Activation bars sit above the lifelines but below the arrows. -->
        <rect
          v-for="(activation, index) in laidActivations"
          :key="`act-${index}`"
          class="seq-activation"
          :class="activation.kind ? `kind-${activation.kind}` : ''"
          :x="activation.x"
          :y="activation.y"
          width="10"
          :height="activation.height"
          rx="3"
        />

        <!-- Messages, ordered top-to-bottom. -->
        <g v-for="message in laidMessages" :key="message.id" class="seq-msg">
          <path
            v-if="message.self"
            class="seq-arrow-line"
            :class="`v-${message.variant}`"
            :d="loopPath(message)"
            fill="none"
            :marker-end="message.open ? 'url(#seq-open)' : 'url(#seq-solid)'"
          />
          <line
            v-else
            class="seq-arrow-line"
            :class="`v-${message.variant}`"
            :x1="message.x1 + (message.x2 > message.x1 ? 8 : -8)"
            :y1="message.y"
            :x2="message.x2 + (message.x2 > message.x1 ? -8 : 8)"
            :y2="message.y"
            :marker-end="message.open ? 'url(#seq-open)' : 'url(#seq-solid)'"
          />
          <text class="seq-label" :x="message.labelX" :y="message.y - 9" text-anchor="middle">{{ message.label }}</text>
          <text v-if="message.note" class="seq-note" :x="message.labelX" :y="message.y + 13" text-anchor="middle">{{ message.note }}</text>
        </g>

        <!-- Heads drawn last so their opaque mask covers any arrow that reaches the top. -->
        <g
          v-for="(participant, index) in participants"
          :key="`head-${participant.id}`"
          class="seq-head-group"
          :class="participant.kind ? `kind-${participant.kind}` : ''"
        >
          <rect class="seq-head-mask" :x="participantCx(index) - HEAD_W / 2" :y="HEAD_TOP" :width="HEAD_W" :height="HEAD_H" rx="8" />
          <rect
            class="seq-head"
            :x="participantCx(index) - HEAD_W / 2"
            :y="HEAD_TOP"
            :width="HEAD_W"
            :height="HEAD_H"
            rx="8"
            tabindex="0"
            role="button"
            :aria-label="participant.label"
            @click="askParticipant(participant)"
            @keydown.enter.prevent="askParticipant(participant)"
            @keydown.space.prevent="askParticipant(participant)"
          />
          <text class="seq-head-label" :x="participantCx(index)" :y="HEAD_TOP + (participant.sublabel ? 24 : 31)" text-anchor="middle">
            {{ participant.label }}
          </text>
          <text v-if="participant.sublabel" class="seq-head-sub" :x="participantCx(index)" :y="HEAD_TOP + 40" text-anchor="middle">
            {{ participant.sublabel }}
          </text>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.seq-shell { border: 1px solid var(--line); border-radius: var(--r-md); background: var(--panel); }
.seq-scroll { overflow-x: auto; padding: 4px; }
.seq-svg { display: block; font-family: var(--font-sans); }
.seq-empty { margin: 0; padding: 16px; color: var(--muted); font-size: 13px; }

.seq-lifeline { stroke: var(--line-strong); stroke-width: 1; stroke-dasharray: 3 7; }

.seq-head-mask { fill: var(--panel); }
.seq-head {
  fill: color-mix(in srgb, var(--kind, var(--external)) 12%, var(--panel));
  stroke: var(--kind, var(--external));
  stroke-width: 1.5;
  cursor: pointer;
}
.seq-head:hover { fill: color-mix(in srgb, var(--kind, var(--external)) 20%, var(--panel)); }
.seq-head-label { fill: var(--ink-strong); font-size: 12px; font-weight: 600; }
.seq-head-sub { fill: var(--muted); font: 500 9px var(--font-mono); letter-spacing: .02em; }

.seq-activation {
  fill: color-mix(in srgb, var(--kind, var(--external)) 22%, var(--panel));
  stroke: var(--kind, var(--external));
  stroke-width: 1;
}

.seq-arrow-line { stroke-width: 1.4; fill: none; }
.seq-arrow-line.v-default { stroke: var(--dim); }
.seq-arrow-line.v-emphasis { stroke: var(--backend); stroke-width: 2; }
.seq-arrow-line.v-security { stroke: var(--security); stroke-dasharray: 5 5; }
.seq-arrow-line.v-dashed { stroke: var(--dim); stroke-dasharray: 6 5; }
.seq-arrow-line.v-return { stroke: var(--dim); stroke-dasharray: 3 5; }
.seq-marker-solid { fill: context-stroke; }
.seq-marker-open { fill: none; stroke: context-stroke; stroke-width: 1.4; }

.seq-label { fill: var(--ink-strong); font-size: 11.5px; }
.seq-note { fill: var(--muted); font: 500 9px var(--font-mono); }
</style>


