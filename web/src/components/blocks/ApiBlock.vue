<script setup lang="ts">
import { computed, ref } from 'vue'
import type { z } from 'zod'
import type { apiBlockSchema, ApiEndpoint, ApiTiming } from '../../../../src/core/model'
import type { Artifact } from '../../../../src/core/model'
import { artifactUrl } from '../../api'

const props = defineProps<{ block: z.infer<typeof apiBlockSchema>; artifacts?: Artifact[] }>()
const emit = defineEmits<{ ask: [selection: { type: 'api'; id: string; label?: string }] }>()

const query = ref('')
const openId = ref('')

const matches = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.block.endpoints
  return props.block.endpoints.filter((endpoint) => JSON.stringify(endpoint).toLowerCase().includes(needle))
})

const rows = computed(() => matches.value.map((endpoint) => ({
  endpoint,
  lead: leadTiming(endpoint),
  breakdown: endpoint.timing ? breakdownSegments(endpoint.timing) : undefined,
  aggregates: endpoint.timing ? timingAggregates(endpoint.timing) : [],
})))

function toggle(id: string) {
  openId.value = openId.value === id ? '' : id
}

function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`
  return `${Math.round(value * 10) / 10} ms`
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
                <span class="api-timing-value" :class="{ estimated: isEstimated(row.endpoint.timing) }">
                  {{ row.lead ? `${row.lead.label} ${formatMs(row.lead.value)}` : '—' }}
                </span>
                <span class="api-timing-source" :class="{ estimated: isEstimated(row.endpoint.timing) }">
                  {{ sourceLabel(row.endpoint.timing) }}
                </span>
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
                      <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Example</th></tr></thead>
                      <tbody>
                        <tr v-for="param in row.endpoint.request.params" :key="`${param.in}-${param.name}`">
                          <td>{{ param.name }}<span v-if="param.required" class="api-required">*</span></td>
                          <td class="api-dim">{{ param.in }}</td>
                          <td class="api-dim">{{ param.type || '—' }}</td>
                          <td class="api-dim">{{ inline(param.example) || '—' }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <template v-if="row.endpoint.request?.body">
                      <p class="api-detail-label">{{ row.endpoint.request.body.contentType || 'Body' }}</p>
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
                  <p class="api-detail-label">Timing · {{ row.endpoint.timing.unit }}</p>
                  <div class="api-timing-head">
                    <span class="api-timing-source" :class="{ estimated: isEstimated(row.endpoint.timing) }">
                      {{ sourceLabel(row.endpoint.timing) }}
                    </span>
                    <span v-for="aggregate in row.aggregates" :key="aggregate.label" class="api-timing-agg">
                      <small>{{ aggregate.label }}</small><strong>{{ formatMs(aggregate.value) }}</strong>
                    </span>
                    <span v-if="row.endpoint.timing.sampleSize" class="api-dim">n={{ row.endpoint.timing.sampleSize }}</span>
                    <span v-if="row.endpoint.timing.measuredAt" class="api-dim">{{ row.endpoint.timing.measuredAt }}</span>
                  </div>
                  <div v-if="row.breakdown?.parts.length" class="api-waterfall">
                    <span
                      v-for="part in row.breakdown.parts"
                      :key="part.key"
                      class="api-waterfall-seg"
                      :style="{ flexGrow: Math.max(part.share, 0.02) }"
                    >
                      <small>{{ part.label }}</small><strong>{{ formatMs(part.value) }}</strong>
                    </span>
                  </div>
                  <p v-if="row.endpoint.timing.note" class="api-timing-note">{{ row.endpoint.timing.note }}</p>
                  <a v-if="row.endpoint.timing.artifactRef" :href="artifactUrl(row.endpoint.timing.artifactRef)" target="_blank">
                    {{ artifactName(row.endpoint.timing.artifactRef) }} ↗
                  </a>
                </section>

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
