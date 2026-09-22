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

/** Cases linked to the current DSH session stay visible even while the global search narrows the rest. */
const linked = computed(() => link.value?.cases ?? [])

function caseUrl(id: string) {
  return sessionId.value ? `/cases/${id}?session=${encodeURIComponent(sessionId.value)}` : `/cases/${id}`
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
    <section class="hero">
      <div>
        <p class="eyebrow">INVESTIGATION LIBRARY</p>
        <h1>Cases that keep<br><em>the thread intact.</em></h1>
        <p class="hero-copy">调查结论、调用链与证据，跨 Session 持续生长。</p>
      </div>
      <div class="hero-stat">
        <strong>{{ cases.length || linked.length }}</strong>
        <span>cases documented</span>
      </div>
    </section>

    <section v-if="sessionId" class="session-banner">
      <template v-if="linked.length">
        <p class="eyebrow">CURRENT SESSION</p>
        <h2>当前会话关联 {{ linked.length }} 个 Case</h2>
        <p>选择要继续阅读的 Case；不会自动猜测。</p>
        <div class="session-cases">
          <RouterLink v-for="item in linked" :key="item.id" class="session-case" :to="caseUrl(item.id)">
            <strong>{{ item.title }}</strong>
            <small>{{ item.type || 'exploration' }} · r{{ item.revision }} · {{ item.status }}</small>
          </RouterLink>
        </div>
      </template>
      <template v-else>
        <p class="eyebrow">CURRENT SESSION</p>
        <h2>当前会话尚未关联 Case</h2>
        <p>可让 Agent 调用 tracebook_open 创建或关联。</p>
        <div class="session-actions">
          <code>{{ ASK_PROMPT }}</code>
          <button class="ghost" @click="copyPrompt">{{ copied ? '已复制' : '复制提示词' }}</button>
        </div>
      </template>
    </section>

    <section class="case-library">
      <div class="section-heading">
        <h2>All cases</h2>
        <label class="search-box">
          <span>⌕</span>
          <input v-model="query" type="search" placeholder="Search cases" />
        </label>
      </div>
      <p v-if="loading" class="state-card">Loading cases…</p>
      <p v-else-if="error" class="state-card error">{{ error }}</p>
      <div v-else-if="filtered.length" class="case-grid">
        <RouterLink v-for="item in filtered" :key="item.id" class="case-card" :to="caseUrl(item.id)">
          <div class="card-topline">
            <span class="case-type">{{ item.type || 'exploration' }}</span>
            <span class="status-dot" :class="item.status" />
          </div>
          <h3>{{ item.title }}</h3>
          <p>{{ item.summary || 'No summary has been written yet.' }}</p>
          <dl>
            <div><dt>Blocks</dt><dd>{{ item.blockCount }}</dd></div>
            <div><dt>Evidence</dt><dd>{{ item.artifactCount }}</dd></div>
            <div><dt>Revision</dt><dd>r{{ item.revision }}</dd></div>
          </dl>
          <time>{{ new Date(item.updatedAt).toLocaleString() }}</time>
        </RouterLink>
      </div>
      <div v-else class="state-card empty">
        <span class="empty-glyph">◇</span>
        <h3>No cases yet</h3>
        <p>Ask the DSH Agent to open a Tracebook case, then results will appear here.</p>
      </div>
    </section>
  </main>
</template>
