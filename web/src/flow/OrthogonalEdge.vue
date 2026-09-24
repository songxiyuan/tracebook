<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import { BaseEdge } from '@vue-flow/core'
import type { Point } from './elk-layout'

/**
 * An edge that follows ELK's orthogonal route instead of a Vue Flow bézier.
 * `data.points` are the polyline points ELK computed (start, bends…, end); we
 * only round the 90° corners. This is what untangles the graph — Vue Flow no
 * longer invents its own curve between the handles.
 *
 * Falling back to the straight source→target segment keeps an edge visible if
 * ELK returned no section for it.
 */
const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  data?: { points?: Point[] }
  markerEnd?: string
  style?: CSSProperties
}>()

function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

/** Rounded-corner path through axis-aligned points; corners clamp to segment halves. */
function roundedOrthogonalPath(points: Point[], radius = 8): string {
  if (points.length < 2) return ''
  const first = points[0]!
  const d: string[] = [`M ${first.x},${first.y}`]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!
    const corner = points[i]!
    const next = points[i + 1]!
    const inLen = Math.abs(corner.x - prev.x) + Math.abs(corner.y - prev.y)
    const outLen = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const inDir = { x: sign(corner.x - prev.x), y: sign(corner.y - prev.y) }
    const outDir = { x: sign(next.x - corner.x), y: sign(next.y - corner.y) }
    const before = { x: corner.x - inDir.x * r, y: corner.y - inDir.y * r }
    const after = { x: corner.x + outDir.x * r, y: corner.y + outDir.y * r }
    d.push(`L ${before.x},${before.y}`)
    d.push(`Q ${corner.x},${corner.y} ${after.x},${after.y}`)
  }
  const last = points[points.length - 1]!
  d.push(`L ${last.x},${last.y}`)
  return d.join(' ')
}

const path = computed(() => {
  const points = props.data?.points
  if (points && points.length >= 2) return roundedOrthogonalPath(points)
  return `M ${props.sourceX},${props.sourceY} L ${props.targetX},${props.targetY}`
})
</script>

<template>
  <BaseEdge :id="id" :path="path" :marker-end="markerEnd" :style="style" />
</template>
