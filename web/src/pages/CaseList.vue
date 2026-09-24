<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listCases, sessionCases, type SessionCases } from '../api'
import { rememberSession, sessionId } from '../session'
import type { CaseSummary } from '../../../src/core/model'

const route = useRoute()
const router = useRouter()
const cases = ref<CaseSummary[]>([])
const link = ref<SessionCases>()
const query = ref('')
const loading = ref(true)
const error = ref('')
const copied = ref(false)

// Faceted narrowing + column sort, all client-side over the loaded list.
const statusFilter = ref('')
const typeFilter = ref('')
const envFilter = ref('')
type SortKey = 'title' | 'updatedAt' | 'revision' | 'blockCount'
const sortKey = ref<SortKey>('updatedAt')
const sortDir = ref<'asc' | 'desc'>('desc')

const ASK_PROMPT = '请调用 tracebook_open，为当前调查创建一个 Tracebook Case。'

/** Distinct, sorted facet values present in the library, for the filter selects. */
const types = computed(() => [...new Set(cases.value.map((item) => item.type || 'exploration'))].sort())
const environments = computed(() => [...new Set(cases.value.map((item) => item.environment).filter((value): value is string => !!value))].sort())

const hasFilters = computed(() => !!(query.value.trim() || statusFilter.value || typeFilter.value || envFilter.value))
function clearFilters() {
  query.value = ''
  statusFilter.value = ''
  typeFilter.value = ''
  envFilter.value = ''
}

/** Toggle direction when re-clicking the active column, else sort by the new column. */
function sortBy(key: SortKey) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = key; sortDir.value = key === 'title' ? 'asc' : 'desc' }
}
function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
  if (sortKey.value !== key) return 'none'
  return sortDir.value === 'asc' ? 'ascending' : 'descending'
}

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const rows = cases.value.filter((item) => {
    if (needle && !JSON.stringify(item).toLowerCase().includes(needle)) return false
    if (statusFilter.value && item.status !== statusFilter.value) return false
    if (typeFilter.value && (item.type || 'exploration') !== typeFilter.value) return false
    if (envFilter.value && item.environment !== envFilter.value) return false
    return true
  })
  const dir = sortDir.value === 'asc' ? 1 : -1
  const key = sortKey.value
  return [...rows].sort((a, b) => {
    let cmp: number
    if (key === 'title') cmp = a.title.localeCompare(b.title)
    else if (key === 'updatedAt') cmp = a.updatedAt.localeCompare(b.updatedAt)
    else cmp = (a[key] ?? 0) - (b[key] ?? 0)
    return cmp * dir
  })
})

/** The library header reports the whole library, never the narrowed view. */
const stats = computed(() => ({
  active: cases.value.filter((item) => item.status === 'active').length,
  blocks: cases.value.reduce((total, item) => total + item.blockCount, 0),
  artifacts: cases.value.reduce((total, item) => total + item.artifactCount, 0),
}))

/** Cases linked to the current DSH session stay visible even while the global search narrows the rest. */
const linked = computed(() => link.value?.cases ?? [])

function caseUrl(id: string) {
  return sessionId.value ? `/cases/${id}?session=${encodeURIComponent(sessionId.value)}` : `/cases/${id}`
}

/** Compact timestamps keep a dense table scannable. */
function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(ASK_PROMPT)
    copied.value = true
  } catch {
    copied.value = false
  }
}

/** Resolve the query params into either a redirect to the session's case or the full list. */
async function resolve() {
  const fromQuery = route.query.session
  if (typeof fromQuery === 'string') rememberSession(fromQuery)
  // `all=1` is the explicit "browse everything" entry (the detail page's back
  // link); without it a session-aware open lands on the linked case instead.
  const browseAll = route.query.all === '1'
  loading.value = true
  error.value = ''
  try {
    const id = sessionId.value
    if (id) {
      link.value = await sessionCases(id)
      const target = browseAll
        ? undefined
        : link.value.activeCaseId ?? (link.value.cases.length === 1 ? link.value.cases[0]?.id : undefined)
      if (target) {
        await router.replace(caseUrl(target))
        return
      }
    }
    cases.value = await listCases()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

onMounted(resolve)

// Navigation between the session-scoped view and the full list changes only the
// query, not the route, so re-resolve when either param moves.
watch(() => [route.query.session, route.query.all], () => { void resolve() })
</script>

<template>
  <main class="list-page">
    <header class="page-head">
      <div>
        <h1>Cases</h1>
        <p>Agent 沉淀的调查结论、调用链与关键发现，跨 Session 持续生长。</p>
      </div>
      <span class="page-spacer" />
      <dl class="stat-strip">
        <div><dt>Cases</dt><dd>{{ cases.length }}</dd></div>
        <div><dt>Active</dt><dd class="signal">{{ stats.active }}</dd></div>
        <div><dt>Blocks</dt><dd>{{ stats.blocks }}</dd></div>
        <div><dt>Artifacts</dt><dd>{{ stats.artifacts }}</dd></div>
      </dl>
    </header>

    <section v-if="sessionId" class="session-strip">
      <p class="eyebrow">Current session</p>
      <template v-if="linked.length">
        <p>关联 {{ linked.length }} 个 Case，选择要继续阅读的一个：</p>
        <div class="session-cases">
          <RouterLink v-for="item in linked" :key="item.id" class="session-case" :to="caseUrl(item.id)">
            <strong>{{ item.title }}</strong>
            <small>{{ item.type || 'exploration' }} · r{{ item.revision }} · {{ item.status }}</small>
          </RouterLink>
        </div>
      </template>
      <template v-else>
        <p>当前会话尚未关联 Case，可让 Agent 调用 tracebook_open 创建或关联：</p>
        <code>{{ ASK_PROMPT }}</code>
        <button class="ghost" @click="copyPrompt">{{ copied ? '已复制' : '复制提示词' }}</button>
      </template>
    </section>

    <section class="case-library">
      <div class="section-heading">
        <h2>All cases</h2>
        <span class="count">{{ filtered.length }} / {{ cases.length }}</span>
        <span class="heading-spacer" />
        <select v-model="statusFilter" class="filter-select" aria-label="Filter by status">
          <option value="">All status</option>
          <option value="active">active</option>
          <option value="completed">completed</option>
          <option value="archived">archived</option>
        </select>
        <select v-if="types.length > 1" v-model="typeFilter" class="filter-select" aria-label="Filter by type">
          <option value="">All types</option>
          <option v-for="type in types" :key="type" :value="type">{{ type }}</option>
        </select>
        <select v-if="environments.length" v-model="envFilter" class="filter-select" aria-label="Filter by environment">
          <option value="">All environments</option>
          <option v-for="env in environments" :key="env" :value="env">{{ env }}</option>
        </select>
        <label class="search-box">
          <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path d="M10.6 10.6 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <input v-model="query" type="search" placeholder="Search cases" aria-label="Search cases" />
        </label>
        <button v-if="hasFilters" class="ghost filter-clear" @click="clearFilters">Clear</button>
      </div>

      <p v-if="loading" class="state-card">Loading cases…</p>
      <p v-else-if="error" class="state-card error">{{ error }}</p>

      <div v-else-if="filtered.length" class="table-wrap case-table">
        <table>
          <thead>
            <tr>
              <th :aria-sort="ariaSort('title')">
                <button type="button" class="col-sort" @click="sortBy('title')">Case<i class="sort-caret" :class="ariaSort('title')" /></button>
              </th>
              <th>Type</th>
              <th class="col-optional">Environment</th>
              <th>Status</th>
              <th class="num">
                <button type="button" class="col-sort" @click="sortBy('blockCount')">Blocks<i class="sort-caret" :class="ariaSort('blockCount')" /></button>
              </th>
              <th class="num col-optional">Artifacts</th>
              <th class="num" :aria-sort="ariaSort('revision')">
                <button type="button" class="col-sort" @click="sortBy('revision')">Rev<i class="sort-caret" :class="ariaSort('revision')" /></button>
              </th>
              <th class="col-optional" :aria-sort="ariaSort('updatedAt')">
                <button type="button" class="col-sort" @click="sortBy('updatedAt')">Updated<i class="sort-caret" :class="ariaSort('updatedAt')" /></button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in filtered" :key="item.id">
              <td class="case-title">
                <RouterLink :to="caseUrl(item.id)">{{ item.title }}</RouterLink>
                <small>{{ item.summary || 'No summary has been written yet.' }}</small>
              </td>
              <td><span class="tag">{{ item.type || 'exploration' }}</span></td>
              <td class="col-optional cell-dim">{{ item.environment || '—' }}</td>
              <td><span class="status" :class="item.status"><i />{{ item.status }}</span></td>
              <td class="num">{{ item.blockCount }}</td>
              <td class="num col-optional">{{ item.artifactCount }}</td>
              <td class="num">r{{ item.revision }}</td>
              <td class="col-optional cell-dim">{{ formatTime(item.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="!cases.length" class="state-card empty">
        <h3>No cases yet</h3>
        <p>Ask the DSH Agent to open a Tracebook case, then results will appear here.</p>
      </div>

      <div v-else class="state-card empty">
        <h3>No cases match your filters</h3>
        <p>当前的搜索与筛选条件没有匹配到任何 Case。</p>
        <button class="ghost" @click="clearFilters">Clear filters</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.filter-select {
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--panel-2);
  color: var(--ink);
  font: 500 11px/1 var(--font-mono);
}
.filter-select:focus { border-color: var(--frontend); outline: none; }
.filter-clear { height: 26px; padding: 0 10px; }

/* Sortable column header: the whole label is the button, with a direction caret. */
.col-sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}
.col-sort:hover { color: var(--frontend); }
.num .col-sort { flex-direction: row-reverse; }
.sort-caret {
  width: 0;
  height: 0;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  opacity: .3;
}
.sort-caret.ascending { border-bottom: 4px solid currentColor; opacity: 1; }
.sort-caret.descending { border-top: 4px solid currentColor; opacity: 1; }
</style>

