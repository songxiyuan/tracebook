<script setup lang="ts">
import { computed, nextTick, ref, type ComponentPublicInstance } from 'vue'
import type { z } from 'zod'
import type { apiBlockSchema, ApiEndpoint, ApiTiming } from '../../../../src/core/model'
import type { Artifact } from '../../../../src/core/model'
import {
  harDocumentForEntries,
  matchHarEntries,
  parseHarDocument,
  type HarDocumentView,
} from '../../../../src/core/har'
import { artifactUrl } from '../../api'

const props = defineProps<{ block: z.infer<typeof apiBlockSchema>; artifacts?: Artifact[] }>()
const emit = defineEmits<{ ask: [selection: { type: 'api'; id: string; label?: string }] }>()

const query = ref('')
const openId = ref('')

/**
 * HAR is read lazily, per endpoint, only when a reader opens it. Flat rather
 * than a discriminated union so the template can read `.message` without a
 * narrowing helper.
 */
interface HarState {
  status: 'loading' | 'ready' | 'error'
  document?: HarDocumentView
  entryCount?: number
  message?: string
}

const harStates = ref<Record<string, HarState>>({})

/**
 * HAR state is keyed by endpoint id *and* the artifact it cites, so a block
 * update that swaps the referenced artifact resets the state instead of
 * short-circuiting on a stale `ready`/`loading` entry.
 */
function harKey(endpoint: ApiEndpoint): string {
  return `${endpoint.id}::${endpoint.timing?.artifactRef ?? ''}`
}

function setHarState(key: string, state: HarState) {
  harStates.value = { ...harStates.value, [key]: state }
}

function harStateFor(key: string): HarState | undefined {
  return harStates.value[key]
}

/** The chart element per endpoint, so the HAR is handed over as a property. */
const charts = new Map<string, HTMLElement & { har?: unknown }>()

/**
 * The renderer and its stylesheet load only when a HAR is actually opened, so
 * a case that never carries one pays nothing for the capability.
 */
let waterfallModule: Promise<unknown> | undefined
function ensureWaterfall(): Promise<unknown> {
  waterfallModule ??= import('@cloudflare/waterfall')
  return waterfallModule
}

function bindChart(id: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) {
    charts.set(id, el as HTMLElement & { har?: unknown })
    applyChart(id)
    return
  }
  charts.delete(id)
}

function applyChart(id: string) {
  const chart = charts.get(id)
  const state = harStateFor(id)
  if (!chart || state?.status !== 'ready' || !state.document) return
  chart.har = state.document
}

/**
 * Load the HAR an endpoint's timing cites, keep only the requests that belong
 * to it, and hand the result to the chart. Every failure falls back to the
 * summary phase bar with the reason shown, never to an empty chart.
 */
async function loadEndpointHar(id: string) {
  const endpoint = props.block.endpoints.find((entry) => entry.id === id)
  const timing = endpoint?.timing
  if (!endpoint || timing?.source !== 'har' || !timing.artifactRef) return
  const key = harKey(endpoint)
  const existing = harStateFor(key)
  if (existing?.status === 'ready' || existing?.status === 'loading') return
  const artifactId = timing.artifactRef
  setHarState(key, { status: 'loading' })
  try {
    const response = await fetch(artifactUrl(artifactId))
    if (!response.ok) throw new Error(`HAR artifact read failed (${response.status})`)
    const document = parseHarDocument(await response.text())
    if (!document) throw new Error('Artifact is not a HAR document')
    const entries = matchHarEntries(document, endpoint.method, endpoint.path)
    if (!entries.length) throw new Error('No captured request matches this endpoint')
    await ensureWaterfall()
    setHarState(key, {
      status: 'ready',
      document: harDocumentForEntries(document, entries),
      entryCount: entries.length,
    })
    // The element only exists once the ready branch has painted.
    await nextTick()
    applyChart(key)
  } catch (reason) {
    setHarState(key, {
      status: 'error',
      message: reason instanceof Error ? reason.message : String(reason),
    })
  }
}

const matches = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.block.endpoints
  return props.block.endpoints.filter((endpoint) => JSON.stringify(endpoint).toLowerCase().includes(needle))
})

const rows = computed(() => matches.value.map((endpoint) => {
  const lead = leadTiming(endpoint)
  return {
    endpoint,
    lead,
    breakdown: endpoint.timing ? breakdownSegments(endpoint.timing) : undefined,
    aggregates: endpoint.timing ? timingAggregates(endpoint.timing) : [],
    har: harStates.value[harKey(endpoint)],
    // Only a threshold someone actually declared may colour the number.
    overBudget: lead !== undefined
      && endpoint.expectedMs !== undefined
      && lead.value > endpoint.expectedMs,
  }
}))

function toggle(id: string) {
  const next = openId.value === id ? '' : id
  openId.value = next
  if (next) void loadEndpointHar(next)
}

/**
 * Render a duration in the timing's own unit. The schema pins `unit` to 'ms',
 * so a value is milliseconds; it reads as seconds past 1000ms with the suffix
 * following the number, so the printed value and its unit never disagree.
 */
function formatDuration(value: number, unit: ApiTiming['unit'] = 'ms'): string {
  if (unit === 'ms' && value >= 1000) return `${(value / 1000).toFixed(2)} s`
  return `${Math.round(value * 10) / 10} ${unit}`
}

/**
 * The one number the list shows. p95 is the review default because an average
 * hides the slow tail; smaller sources fall back to what they actually carry.
 */
function leadTiming(endpoint: ApiEndpoint): { label: string; value: number } | undefined {
  const timing = endpoint.timing
  if (!timing) return undefined
  if (timing.p95 !== undefined) return { label: 'p95', value: timing.p95 }
  if (timing.p50 !== undefined) return { label: 'p50', value: timing.p50 }
  if (timing.max !== undefined) return { label: 'max', value: timing.max }
  const samples = timing.samples
  if (!samples?.length) return undefined
  return { label: 'last', value: samples[samples.length - 1]! }
}

function timingAggregates(timing: ApiTiming): Array<{ label: string; value: number }> {
  const entries: Array<[string, number | undefined]> = [
    ['p50', timing.p50], ['p95', timing.p95], ['p99', timing.p99], ['max', timing.max],
  ]
  return entries
    .filter((entry): entry is [string, number] => entry[1] !== undefined)
    .map(([label, value]) => ({ label, value }))
}

function breakdownSegments(timing: ApiTiming): { total: number; parts: Array<{ key: string; label: string; value: number; share: number }> } | undefined {
  const candidates: Array<[string, string, number | undefined]> = [
    ['dns', 'DNS', timing.breakdown?.dns],
    ['connect', 'Connect', timing.breakdown?.connect],
    ['ttfb', 'TTFB', timing.breakdown?.ttfb],
    ['download', 'Download', timing.breakdown?.download],
  ]
  const parts = candidates.filter((entry): entry is [string, string, number] => entry[2] !== undefined)
  if (!parts.length) return undefined
  const total = parts.reduce((sum, [, , value]) => sum + value, 0)
  return {
    total,
    parts: parts.map(([key, label, value]) => ({ key, label, value, share: total > 0 ? value / total : 0 })),
  }
}

const SOURCE_LABELS: Record<ApiTiming['source'], string> = {
  trace: 'Trace',
  har: 'HAR',
  log: 'Log',
  metrics: 'Metrics',
  estimated: '估算',
}

function sourceLabel(timing: ApiTiming): string {
  return SOURCE_LABELS[timing.source]
}

/** Only a real observation may read as measured; inference is labelled everywhere it appears. */
function isEstimated(timing: ApiTiming): boolean {
  return timing.source === 'estimated'
}

const EXAMPLE_SOURCE_LABELS: Record<'observed' | 'spec' | 'inferred', string> = {
  observed: '实测',
  spec: 'Spec',
  inferred: '示意',
}

/**
 * An example without a source is rejected by the schema, so an invented
 * illustration and a captured response never render identically.
 */
function exampleSourceLabel(source: 'observed' | 'spec' | 'inferred' | undefined): string {
  return source ? EXAMPLE_SOURCE_LABELS[source] : EXAMPLE_SOURCE_LABELS.inferred
}

/** CSS class form of the source; the label stays in the template text. */
function exampleSourceClass(source: 'observed' | 'spec' | 'inferred' | undefined): string {
  return `source-${source ?? 'inferred'}`
}

/** Error rate is derived from the two counts, never stored twice and allowed to drift. */
function errorRate(timing: ApiTiming): string | undefined {
  // A zero (or missing) denominator has no rate; never divide it into `err NaN%`.
  if (timing.errorCount === undefined || timing.sampleSize === undefined || timing.sampleSize < 1) return undefined
  return `${((timing.errorCount / timing.sampleSize) * 100).toFixed(1)}%`
}

function formatWindow(window: { from: string; to: string }): string {
  return `${window.from} → ${window.to}`
}

function statusKind(status: number): string {
  if (status >= 400) return 'kind-security'
  if (status >= 300) return 'kind-cloud'
  return 'kind-backend'
}

function requestSummary(endpoint: ApiEndpoint): string {
  const parts: string[] = []
  const params = endpoint.request?.params ?? []
  if (params.length) parts.push(`${params.length} params`)
  if (endpoint.request?.body) parts.push(endpoint.request.body.contentType || 'body')
  return parts.join(' · ')
}

function responseSummary(endpoint: ApiEndpoint): string {
  const responses = endpoint.responses ?? []
  return responses.map((response) => response.status).join(' / ')
}

function pretty(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

/** Inline rendering for a table cell; objects stay compact so rows do not blow up. */
function inline(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  const json = JSON.stringify(value)
  return json.length > 80 ? `${json.slice(0, 80)}…` : json
}

function artifactName(id: string): string {
  const artifact = props.artifacts?.find((entry) => entry.id === id)
  return artifact?.name || artifact?.summary || id
}
</script>

<template>
  <div class="table-tools"><input v-model="query" type="search" placeholder="Filter endpoints…" /></div>
  <div class="api-wrap">
    <table class="api-table">
      <thead>
        <tr>
          <th>Endpoint</th>
          <th>Service</th>
          <th>输入</th>
          <th>输出</th>
          <th>耗时</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.endpoint.id">
          <tr class="api-row" :class="{ open: openId === row.endpoint.id }" @click="toggle(row.endpoint.id)">
            <td class="api-endpoint">
              <button
                class="api-caret"
                :aria-expanded="openId === row.endpoint.id"
                :aria-label="`${openId === row.endpoint.id ? 'Collapse' : 'Expand'} ${row.endpoint.method} ${row.endpoint.path}`"
                @click.stop="toggle(row.endpoint.id)"
              >{{ openId === row.endpoint.id ? '▾' : '▸' }}</button>
              <span class="api-method kind-api">{{ row.endpoint.method }}</span>
              <code>{{ row.endpoint.path }}</code>
              <small v-if="row.endpoint.summary">{{ row.endpoint.summary }}</small>
            </td>
            <td class="api-dim">{{ row.endpoint.service || '—' }}</td>
            <td class="api-dim">{{ requestSummary(row.endpoint) || '—' }}</td>
            <td class="api-dim">{{ responseSummary(row.endpoint) || '—' }}</td>
            <td class="api-timing-cell">
              <template v-if="row.endpoint.timing">
                <span
                  class="api-timing-value"
                  :class="{ estimated: isEstimated(row.endpoint.timing), over: row.overBudget }"
                >
                  {{ row.lead ? `${row.lead.label} ${formatDuration(row.lead.value, row.endpoint.timing?.unit)}` : '—' }}
                </span>
                <span class="api-timing-source" :class="{ estimated: isEstimated(row.endpoint.timing) }">
                  {{ sourceLabel(row.endpoint.timing) }}
                </span>
                <small v-if="errorRate(row.endpoint.timing)" class="api-error-rate">
                  err {{ errorRate(row.endpoint.timing) }}
                </small>
              </template>
              <span v-else class="api-dim">—</span>
            </td>
          </tr>
          <tr v-if="openId === row.endpoint.id" class="api-detail-row">
            <td colspan="5">
              <div class="api-detail">
                <div class="api-detail-grid">
                  <section class="api-detail-section">
                    <p class="api-detail-label">Request</p>
                    <table v-if="row.endpoint.request?.params?.length" class="api-params">
                      <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Example</th><th>Source</th></tr></thead>
                      <tbody>
                        <tr v-for="param in row.endpoint.request.params" :key="`${param.in}-${param.name}`">
                          <td>{{ param.name }}<span v-if="param.required" class="api-required">*</span></td>
                          <td class="api-dim">{{ param.in }}</td>
                          <td class="api-dim">{{ param.type || '—' }}</td>
                          <td class="api-dim">{{ inline(param.example) || '—' }}</td>
                          <td class="api-dim">{{ exampleSourceLabel(param.source) }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <template v-if="row.endpoint.request?.body">
                      <p class="api-detail-label">
                        {{ row.endpoint.request.body.contentType || 'Body' }}
                        <span class="api-example-source" :class="exampleSourceClass(row.endpoint.request.body.source)">
                          {{ exampleSourceLabel(row.endpoint.request.body.source) }}
                        </span>
                      </p>
                      <pre v-if="row.endpoint.request.body.example !== undefined">{{ pretty(row.endpoint.request.body.example) }}</pre>
                      <a
                        v-if="row.endpoint.request.body.schemaArtifactRef"
                        :href="artifactUrl(row.endpoint.request.body.schemaArtifactRef)"
                        target="_blank"
                      >{{ artifactName(row.endpoint.request.body.schemaArtifactRef) }} ↗</a>
                    </template>
                    <p v-if="!row.endpoint.request?.params?.length && !row.endpoint.request?.body" class="api-dim">
                      未记录请求参数。
                    </p>
                  </section>

                  <section class="api-detail-section">
                    <p class="api-detail-label">Responses</p>
                    <div v-for="response in row.endpoint.responses" :key="response.status" class="api-response">
                      <div class="api-response-head">
                        <span class="api-status" :class="statusKind(response.status)">{{ response.status }}</span>
                        <span v-if="response.description">{{ response.description }}</span>
                        <span v-if="response.contentType" class="api-dim">{{ response.contentType }}</span>
                        <span
                          v-if="response.example !== undefined"
                          class="api-example-source"
                          :class="exampleSourceClass(response.source)"
                        >{{ exampleSourceLabel(response.source) }}</span>
                      </div>
                      <pre v-if="response.example !== undefined">{{ pretty(response.example) }}</pre>
                      <a v-if="response.artifactRef" :href="artifactUrl(response.artifactRef)" target="_blank">
                        {{ artifactName(response.artifactRef) }} ↗
                      </a>
                    </div>
                    <p v-if="!row.endpoint.responses?.length" class="api-dim">未记录响应。</p>
                  </section>
                </div>

                <section v-if="row.endpoint.timing" class="api-detail-section api-timing-detail">
                  <p class="api-detail-label">Timing</p>
                  <div class="api-timing-head">
                    <span class="api-timing-source" :class="{ estimated: isEstimated(row.endpoint.timing) }">
                      {{ sourceLabel(row.endpoint.timing) }}
                    </span>
                    <span v-for="aggregate in row.aggregates" :key="aggregate.label" class="api-timing-agg">
                      <small>{{ aggregate.label }}</small><strong>{{ formatDuration(aggregate.value, row.endpoint.timing.unit) }}</strong>
                    </span>
                    <span v-if="row.endpoint.timing.sampleSize" class="api-timing-agg">
                      <small>requests</small><strong>{{ row.endpoint.timing.sampleSize }}</strong>
                    </span>
                    <span v-if="errorRate(row.endpoint.timing)" class="api-timing-agg">
                      <small>errors</small>
                      <strong>{{ row.endpoint.timing.errorCount }} · {{ errorRate(row.endpoint.timing) }}</strong>
                    </span>
                    <span v-if="row.endpoint.timing.measuredAt" class="api-dim">{{ row.endpoint.timing.measuredAt }}</span>
                  </div>
                  <p v-if="row.endpoint.timing.window" class="api-timing-note">
                    Window: {{ formatWindow(row.endpoint.timing.window) }}
                  </p>
                  <p v-if="row.har?.status === 'loading'" class="api-har-note">
                    正在读取 HAR…
                  </p>
                  <template v-else-if="row.har?.status === 'ready'">
                    <p class="api-har-note">
                      HAR 单次请求瀑布 · {{ row.har?.entryCount }} 条匹配请求
                    </p>
                    <waterfall-chart
                      :ref="(el: Element | ComponentPublicInstance | null) => bindChart(harKey(row.endpoint), el)"
                      class="api-har"
                    />
                  </template>
                  <!-- The summary phases stay the fallback whenever no HAR could be read. -->
                  <div
                    v-if="row.har?.status !== 'ready' && row.breakdown?.parts.length"
                    class="api-waterfall"
                  >
                    <span
                      v-for="part in row.breakdown.parts"
                      :key="part.key"
                      class="api-waterfall-seg"
                      :style="{ flexGrow: Math.max(part.share, 0.02) }"
                    >
                      <small>{{ part.label }}</small><strong>{{ formatDuration(part.value, row.endpoint.timing?.unit) }}</strong>
                    </span>
                  </div>
                  <p v-if="row.har?.status === 'error'" class="api-har-note error">
                    {{ row.har?.message }} · 已回退到相位汇总
                  </p>
                  <p v-if="row.endpoint.timing.note" class="api-timing-note">{{ row.endpoint.timing.note }}</p>
                  <a v-if="row.endpoint.timing.artifactRef" :href="artifactUrl(row.endpoint.timing.artifactRef)" target="_blank">
                    {{ artifactName(row.endpoint.timing.artifactRef) }} ↗
                  </a>
                </section>

                <p v-if="row.endpoint.expectedMs !== undefined" class="api-slo" :class="{ over: row.overBudget }">
                  声明耗时 SLO ≤ {{ formatDuration(row.endpoint.expectedMs) }}
                  <span v-if="row.endpoint.expectedRef" class="api-dim">（{{ row.endpoint.expectedRef }}）</span>
                  <template v-if="row.overBudget"> · 超出</template>
                </p>

                <footer class="api-detail-foot">
                  <div v-if="row.endpoint.artifactRefs?.length" class="inspector-links">
                    <strong>Artifacts</strong>
                    <a v-for="id in row.endpoint.artifactRefs" :key="id" :href="artifactUrl(id)" target="_blank">{{ id }}</a>
                  </div>
                  <div v-if="row.endpoint.relatedBlockIds?.length" class="inspector-links">
                    <strong>Related Blocks</strong>
                    <a v-for="id in row.endpoint.relatedBlockIds" :key="id" :href="`#block-${id}`">{{ id }}</a>
                  </div>
                  <button
                    class="ask-button"
                    @click="emit('ask', { type: 'api', id: row.endpoint.id, label: `${row.endpoint.method} ${row.endpoint.path}` })"
                  >Ask about this</button>
                </footer>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-if="!rows.length" class="api-dim api-empty">No endpoint matches “{{ query }}”.</p>
  </div>
</template>
