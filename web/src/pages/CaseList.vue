<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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

const ASK_PROMPT = '请调用 tracebook_open，为当前调查创建一个 Tracebook Case。'

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return cases.value
  return cases.value.filter((item) => JSON.stringify(item).toLowerCase().includes(needle))
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

onMounted(async () => {
  const fromQuery = route.query.session
  if (typeof fromQuery === 'string') rememberSession(fromQuery)
  // `all=1` is the explicit "browse everything" entry (the detail page's back
  // link); without it a session-aware open lands on the linked case instead.
  const browseAll = route.query.all === '1'
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
})
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
        <label class="search-box">
          <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path d="M10.6 10.6 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <input v-model="query" type="search" placeholder="Search cases" />
        </label>
      </div>

      <p v-if="loading" class="state-card">Loading cases…</p>
      <p v-else-if="error" class="state-card error">{{ error }}</p>

      <div v-else-if="filtered.length" class="table-wrap case-table">
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Type</th>
              <th class="col-optional">Environment</th>
              <th>Status</th>
              <th class="num">Blocks</th>
              <th class="num col-optional">Artifacts</th>
              <th class="num">Rev</th>
              <th class="col-optional">Updated</th>
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

      <div v-else class="state-card empty">
        <h3>No cases yet</h3>
        <p>Ask the DSH Agent to open a Tracebook case, then results will appear here.</p>
      </div>
    </section>
  </main>
</template>
