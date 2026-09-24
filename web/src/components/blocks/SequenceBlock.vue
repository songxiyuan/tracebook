<script setup lang="ts">
import { computed } from 'vue'
import type { Artifact, SequenceBlock } from '../../../../src/core/model'
import { artifactUrl } from '../../api'

const props = defineProps<{ block: SequenceBlock; artifacts: Artifact[] }>()

// Layout constants. A sequence reads top-to-bottom, so the height grows with
// the message count while the width grows with the participant count.
const MARGIN_X = 24
const COL_WIDTH = 176
const HEADER_H = 46
const HEADER_GAP = 30
const ROW_H = 62
const BOTTOM_PAD = 24
const SELF_LOOP_W = 46
const SELF_LOOP_H = 22

interface LaidParticipant {
  id: string
  label: string
  kind?: string
  x: number
}

interface LaidMessage {
  id: string
  label: string
  kind: 'sync' | 'async' | 'stream'
  x1: number
  x2: number
  y: number
  labelX: number
  self: boolean
  dashed: boolean
  markerId: string
  meta: string
  href?: string
}

/** Centre of each participant column; the lifeline and every arrow endpoint hang off it. */
const participants = computed<LaidParticipant[]>(() =>
  props.block.participants.map((participant, index) => ({
    id: participant.id,
    label: participant.label,
    kind: participant.kind,
    x: MARGIN_X + COL_WIDTH * index + COL_WIDTH / 2,
  })),
)

const participantX = computed(() => new Map(participants.value.map((participant) => [participant.id, participant.x])))

/** A message's small meta line: status / duration / provenance, only what is present. */
function messageMeta(message: SequenceBlock['messages'][number]): string {
  return [
    message.status !== undefined ? String(message.status) : undefined,
    message.durationMs !== undefined ? `${message.durationMs}ms` : undefined,
    message.timingSource,
  ].filter((part): part is string => part !== undefined).join(' · ')
}

const messages = computed<LaidMessage[]>(() =>
  props.block.messages.map((message, index) => {
    // A message can only reference a declared participant (schema-enforced), so
    // the fallback to the first column is defensive, never the normal path.
    const fallback = participants.value[0]?.x ?? MARGIN_X + COL_WIDTH / 2
    const x1 = participantX.value.get(message.from) ?? fallback
    const x2 = participantX.value.get(message.to) ?? fallback
    const self = message.from === message.to
    const y = HEADER_H + HEADER_GAP + ROW_H * index + ROW_H / 2
    // Only a stored artifact ref makes a message a link; the first ref is the target.
    const ref = message.artifactRefs?.[0]
    return {
      id: message.id,
      label: message.label,
      kind: message.kind,
      x1,
      x2,
      y,
      labelX: self ? x1 + SELF_LOOP_W / 2 : (x1 + x2) / 2,
      self,
      // A synchronous call is a solid line; async and stream (both non-blocking
      // pushes) read as dashed — the same convention the flow diagrams use for
      // async edges, so the two views stay visually consistent.
      dashed: message.kind !== 'sync',
      // sync is a closed arrowhead; async and stream use the open one.
      markerId: message.kind === 'sync' ? 'seq-arrow-solid' : 'seq-arrow-open',
      meta: messageMeta(message),
      href: ref ? artifactUrl(ref) : undefined,
    }
  }),
)

/** A self-message loops out and back on the same lifeline; other messages are a straight arrow. */
function loopPath(message: LaidMessage): string {
  return `M ${message.x1} ${message.y - SELF_LOOP_H / 2}`
    + ` h ${SELF_LOOP_W} v ${SELF_LOOP_H} h ${-SELF_LOOP_W}`
}

const width = computed(() => MARGIN_X * 2 + COL_WIDTH * Math.max(participants.value.length, 1))
const lifelineBottom = computed(() => HEADER_H + HEADER_GAP + ROW_H * props.block.messages.length + BOTTOM_PAD)
const height = computed(() => lifelineBottom.value)

/** Resolve a participant's artifact-friendly display name only for its header hint. */
function participantTitle(participant: LaidParticipant): string {
  return participant.kind ? `${participant.label} · ${participant.kind}` : participant.label
}
</script>

<template>
  <div class="seq-shell">
    <p v-if="!participants.length || !messages.length" class="seq-empty">
      This sequence has no messages to display yet.
    </p>
    <div v-else class="seq-scroll">
      <svg class="seq-svg" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img">
        <defs>
          <!-- A sync call ends in a closed head; async and stream use the open one. -->
          <marker id="seq-arrow-solid" markerWidth="12" markerHeight="12" refX="9" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" class="seq-head-solid" />
          </marker>
          <marker id="seq-arrow-open" markerWidth="12" markerHeight="12" refX="9" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10" class="seq-head-open" />
          </marker>
        </defs>

        <!-- Participants: a header box per column with a lifeline dropping from it. -->
        <g v-for="participant in participants" :key="participant.id" class="seq-participant">
          <line
            class="seq-lifeline"
            :x1="participant.x"
            :y1="HEADER_H"
            :x2="participant.x"
            :y2="lifelineBottom"
          />
          <rect
            class="seq-head-box"
            :x="participant.x - (COL_WIDTH - 32) / 2"
            :y="6"
            :width="COL_WIDTH - 32"
            :height="34"
            rx="6"
          />
          <text class="seq-head-label" :x="participant.x" :y="24" text-anchor="middle">
            <title>{{ participantTitle(participant) }}</title>{{ participant.label }}
          </text>
          <text v-if="participant.kind" class="seq-head-kind" :x="participant.x" :y="37" text-anchor="middle">
            {{ participant.kind }}
          </text>
        </g>

        <!-- Messages: ordered top-to-bottom, each a link when it carries an artifact ref. -->
        <component
          :is="message.href ? 'a' : 'g'"
          v-for="message in messages"
          :key="message.id"
          class="seq-message"
          :class="{ 'is-link': message.href, [`kind-${message.kind}`]: true }"
          :href="message.href"
          :target="message.href ? '_blank' : undefined"
        >
          <path
            v-if="message.self"
            class="seq-arrow"
            :class="{ dashed: message.dashed }"
            :d="loopPath(message)"
            fill="none"
            :marker-end="`url(#${message.markerId})`"
          />
          <line
            v-else
            class="seq-arrow"
            :class="{ dashed: message.dashed }"
            :x1="message.x1"
            :y1="message.y"
            :x2="message.x2"
            :y2="message.y"
            :marker-end="`url(#${message.markerId})`"
          />
          <text class="seq-label" :x="message.labelX" :y="message.y - 9" text-anchor="middle">
            {{ message.label }}<tspan v-if="message.href" class="seq-link-mark"> ↗</tspan>
          </text>
          <text v-if="message.meta" class="seq-meta" :x="message.labelX" :y="message.y + 14" text-anchor="middle">
            {{ message.meta }}
          </text>
        </component>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.seq-shell {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}
.seq-scroll {
  overflow-x: auto;
  padding: 4px;
}
.seq-svg {
  display: block;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.seq-empty {
  margin: 0;
  padding: 16px;
  color: #64748b;
  font-size: 13px;
}
.seq-lifeline {
  stroke: #cbd5e1;
  stroke-width: 1;
  stroke-dasharray: 4 4;
}
.seq-head-box {
  fill: #f8fafc;
  stroke: #cbd5e1;
  stroke-width: 1;
}
.seq-head-label {
  fill: #0f172a;
  font-size: 12px;
  font-weight: 600;
}
.seq-head-kind {
  fill: #64748b;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.seq-arrow {
  stroke: #334155;
  stroke-width: 1.4;
  color: #334155;
}
.seq-arrow.dashed {
  stroke-dasharray: 6 5;
}
.seq-head-solid {
  fill: #334155;
}
.seq-head-open {
  fill: none;
  stroke: #334155;
  stroke-width: 1.6;
}
.seq-label {
  fill: #0f172a;
  font-size: 12px;
}
.seq-meta {
  fill: #64748b;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.seq-message.is-link {
  cursor: pointer;
}
.seq-message.is-link:hover .seq-arrow {
  stroke: var(--frontend, #0e7490);
  color: var(--frontend, #0e7490);
}
.seq-message.is-link:hover .seq-head-solid {
  fill: var(--frontend, #0e7490);
}
.seq-message.is-link:hover .seq-head-open {
  stroke: var(--frontend, #0e7490);
}
.seq-message.is-link:hover .seq-label {
  fill: var(--frontend, #0e7490);
}
.seq-link-mark {
  fill: var(--frontend, #0e7490);
  font-size: 10px;
}
</style>
