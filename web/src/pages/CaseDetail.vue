<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getCase, getRevision, sessionCases, caseEventsUrl, type SessionCases } from '../api'
import BlockRenderer from '../components/blocks/BlockRenderer.vue'
import ArtifactPanel from '../components/ArtifactPanel.vue'
import RevisionHistory from '../components/RevisionHistory.vue'
import {
  embedded,
  onAskResult,
  rememberSession,
  sendAsk,
  sessionId,
  type AskEnvelope,
  type AskResult,
  type AskSelection,
} from '../session'
import { clearFlowSelection } from '../selection'
import { caseToJson, caseToMarkdown, downloadText, slugify } from '../export'
import type { CaseDocument } from '../../../src/core/model'

const route = useRoute()
const document = ref<CaseDocument>()
const loading = ref(true)
const error = ref('')
const outlineOpen = ref(false)
const blockQuery = ref('')
const sessionLink = ref<SessionCases>()
const sessionLinkError = ref('')

/** Server revision waiting to be pulled in; only ever higher than the loaded one. */
const pendingRevision = ref<number>()
const refreshError = ref('')
let pollTimer: number | undefined
/** P3-5: the live-update stream; polling is only a fallback when it is unavailable. */
let eventSource: EventSource | undefined
let disposeAskResult: (() => void) | undefined

type AskTarget = AskSelection & { blockId: string }
const askTarget = ref<AskTarget>()
const askQuestion = ref('')
const askStatus = ref('')
const askError = ref('')
const askBusy = ref(false)
let askTimeout: number | undefined
/** The dialog root, focused when the Ask modal opens so keyboard users start inside it. */
const askDialog = ref<HTMLElement>()

const caseId = computed(() => String(route.params.id))
const linkedToSession = computed(() => {
  const link = sessionLink.value
  if (!link || !sessionId.value) return false
  return link.cases.some((item) => item.id === caseId.value)
})

const blocks = computed(() => {
  const all = document.value?.blocks ?? []
  const needle = blockQuery.value.trim().toLowerCase()
  if (!needle) return all
  return all.filter((block) => JSON.stringify(block).toLowerCase().includes(needle))
})

/**
 * Outline entries keep their document-order number even while a search narrows
 * the list, so an item's number never shifts as the reader types.
 */
const outline = computed(() => {
  const order = new Map((document.value?.blocks ?? []).map((block, index) => [block.id, index + 1]))
  return blocks.value.map((block) => ({
    id: block.id,
    label: block.title || block.type,
    number: order.get(block.id) ?? 0,
  }))
})

/** Section currently in view, so the outline can highlight the reader's place. */
const activeBlockId = ref('')
let sectionObserver: IntersectionObserver | undefined

/** (Re)observe the rendered block sections; the visible list changes with search. */
function observeSections() {
  sectionObserver?.disconnect()
  if (typeof IntersectionObserver === 'undefined') return
  const targets = blocks.value
    .map((block) => globalThis.document.getElementById(`block-${block.id}`))
    .filter((el): el is HTMLElement => el !== null)
  if (!targets.length) { activeBlockId.value = ''; return }
  sectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) activeBlockId.value = entry.target.id.replace(/^block-/, '')
    }
  }, { rootMargin: '0px 0px -70% 0px', threshold: 0 })
  for (const target of targets) sectionObserver.observe(target)
}

const askEnvelope = computed<AskEnvelope | undefined>(() => {
  const target = askTarget.value
  const current = document.value
  if (!target || !current) return undefined
  return {
    caseId: current.id,
    caseTitle: current.title,
    revision: current.revision,
    blockId: target.blockId,
    selection: { type: target.type, id: target.id, ...(target.label ? { label: target.label } : {}) },
    question: askQuestion.value.trim(),
  }
})

/**
 * The Viewer organizes context; it never investigates. The text is the whole
 * follow-up: what was selected, what the reader asked, and the standing
 * instruction to grow the same case instead of opening a new one.
 */
const askText = computed(() => {
  const envelope = askEnvelope.value
  if (!envelope) return ''
  const lines = [
    'Tracebook 追问',
    `Case: ${envelope.caseTitle} (${envelope.caseId}) · Revision ${envelope.revision}`,
    `Block: ${envelope.blockId}`,
    `Selection: ${envelope.selection.type} ${envelope.selection.id}${envelope.selection.label ? ` (${envelope.selection.label})` : ''}`,
    '',
    envelope.question || '（未填写问题，请结合以上上下文继续调查。）',
    '',
    'Context:',
    JSON.stringify(envelope, null, 2),
    '',
    `请继续调查后调用 tracebook_update 更新同一个 Case（caseId=${envelope.caseId}，blockId=${envelope.blockId}），不要新建重复 Case。`,
  ]
  return lines.join('\n')
})

async function load() {
  loading.value = true
  error.value = ''
  // Switching cases fires overlapping loads; only the response for the case the
  // route still points at may be applied.
  const requested = caseId.value
  try {
    const fresh = await getCase(requested)
    if (requested !== caseId.value) return
    document.value = fresh
    pendingRevision.value = undefined
    refreshError.value = ''
  } catch (reason) {
    if (requested !== caseId.value) return
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (requested === caseId.value) loading.value = false
  }
}

async function loadSessionLink() {
  const id = sessionId.value
  if (!id) return
  try {
    sessionLink.value = await sessionCases(id)
    sessionLinkError.value = ''
  } catch {
    sessionLink.value = undefined
    sessionLinkError.value = '无法读取当前 Session 关联的 Case。'
  }
}

/**
 * Refresh the document without losing the reader's place: the scroll offset
 * and the inspected Flow node are restored after the new content paints.
 */
async function refreshContent() {
  const scrollTop = window.scrollY
  const requested = caseId.value
  try {
    const fresh = await getCase(requested)
    // A slow refresh must not overwrite a case the reader has since left.
    if (requested !== caseId.value) return
    document.value = fresh
    pendingRevision.value = undefined
    refreshError.value = ''
    await nextTick()
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollTop, behavior: 'instant' as ScrollBehavior })
    })
  } catch (reason) {
    if (requested !== caseId.value) return
    // Drop the pending banner so the stale "update available" notice does not
    // mask the refresh failure.
    pendingRevision.value = undefined
    refreshError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function checkRevision() {
  if (document.value === undefined || globalThis.document.visibilityState === 'hidden') return
  try {
    const probe = await getRevision(caseId.value)
    refreshError.value = ''
    pendingRevision.value = probe.revision > document.value.revision ? probe.revision : undefined
  } catch (reason) {
    refreshError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

/** Start the ~12s fallback poll if it is not already running. */
function startPolling() {
  if (pollTimer !== undefined) return
  pollTimer = window.setInterval(() => { void checkRevision() }, 12000)
}

/**
 * P3-5: prefer a same-process SSE push for revision changes, and degrade to the
 * previous polling interval when EventSource is unavailable or the stream
 * errors. A `revision` frame runs the exact same probe path the poll used, so
 * the "update available" banner surfaces unchanged — only its trigger differs.
 */
function startRevisionWatch() {
  stopRevisionWatch()
  if (typeof EventSource === 'undefined') {
    startPolling()
    return
  }
  try {
    const source = new EventSource(caseEventsUrl(caseId.value))
    eventSource = source
    source.addEventListener('revision', () => { void checkRevision() })
    source.onerror = () => {
      // The stream dropped (proxy, restart, or an environment without SSE);
      // close it and fall back to polling rather than reconnect-looping.
      source.close()
      if (eventSource === source) eventSource = undefined
      startPolling()
    }
  } catch {
    startPolling()
  }
}

/** Tear down both the stream and the fallback poll. */
function stopRevisionWatch() {
  if (pollTimer !== undefined) { window.clearInterval(pollTimer); pollTimer = undefined }
  if (eventSource) { eventSource.close(); eventSource = undefined }
}

function openAsk(target: AskTarget) {
  askTarget.value = target
  askQuestion.value = ''
  askStatus.value = ''
  askError.value = ''
}

function closeAsk() {
  askTarget.value = undefined
  askQuestion.value = ''
  askStatus.value = ''
  askError.value = ''
}

async function submitAsk() {
  const envelope = askEnvelope.value
  const text = askText.value
  if (!envelope || !text) return
  askBusy.value = true
  askError.value = ''
  try {
    if (sendAsk({ envelope, text })) {
      askStatus.value = '正在插入当前 DSH 对话…'
      // The embedding client acknowledges; a silent client must not leave the
      // button disabled forever.
      if (askTimeout !== undefined) window.clearTimeout(askTimeout)
      askTimeout = window.setTimeout(() => {
        if (!askBusy.value) return
        askBusy.value = false
        askStatus.value = ''
        askError.value = '未收到 DSH 客户端响应，可复制上下文后手动粘贴。'
      }, 3000)
      return
    }
    await navigator.clipboard.writeText(text)
    askStatus.value = '当前不在 DSH 侧边栏中，追问上下文已复制，可粘贴到对话输入框。'
  } catch (reason) {
    askError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (!embedded) askBusy.value = false
  }
}

async function copyAsk() {
  if (!askText.value) return
  try {
    await navigator.clipboard.writeText(askText.value)
    askError.value = ''
    askStatus.value = '追问上下文已复制。'
  } catch (reason) {
    askError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

function handleAskResult(result: AskResult) {
  if (askTimeout !== undefined) window.clearTimeout(askTimeout)
  askBusy.value = false
  if (result.ok) {
    askError.value = ''
    askStatus.value = '已插入当前 DSH 对话输入框，请在对话中确认后发送。'
    return
  }
  askStatus.value = ''
  askError.value = `插入对话失败（${result.reason ?? 'unknown'}），可复制上下文后手动粘贴。`
}

/** Export/print are pure client-side projections of the loaded document. */
function exportJson() {
  const doc = document.value
  if (!doc) return
  downloadText(`${slugify(doc.title)}.json`, caseToJson(doc), 'application/json')
}
function exportMarkdown() {
  const doc = document.value
  if (!doc) return
  downloadText(`${slugify(doc.title)}.md`, caseToMarkdown(doc), 'text/markdown')
}
function printCase() { window.print() }

/**
 * Keep Tab focus inside the Ask dialog while it is open, so a keyboard user
 * cannot tab out into the page behind the modal (the dialog already grabs
 * initial focus and closes on Esc).
 */
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const root = askDialog.value
  if (!root) return
  const focusable = Array.from(
    root.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = globalThis.document.activeElement
  if (event.shiftKey && active === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
}

watch(caseId, () => {
  clearFlowSelection()
  void load()
  void loadSessionLink()
  // The events URL is case-scoped, so re-point the watch when the id changes.
  startRevisionWatch()
})

watch(() => route.query.session, (value) => {
  if (typeof value === 'string') rememberSession(value)
  void loadSessionLink()
})

// The visible sections change with search and with a pulled-in revision; keep
// the scroll-spy observer pointed at whatever is currently on screen.
watch(blocks, () => { void nextTick().then(observeSections) })

// Move keyboard focus into the Ask dialog the moment it opens.
watch(askTarget, (target) => {
  if (!target) return
  void nextTick().then(() => askDialog.value?.focus())
})

// Refine the browser tab title to the loaded case (the router only sets the
// generic default for this route, since the title is not known at navigation).
watch(() => document.value?.title, (title) => {
  if (title) globalThis.document.title = `${title} · Tracebook`
})

onMounted(async () => {
  const fromQuery = route.query.session
  if (typeof fromQuery === 'string') rememberSession(fromQuery)
  disposeAskResult = onAskResult(handleAskResult)
  await load()
  await loadSessionLink()
  await nextTick()
  observeSections()
  startRevisionWatch()
  window.addEventListener('focus', checkRevision)
  globalThis.document.addEventListener('visibilitychange', checkRevision)
})

onBeforeUnmount(() => {
  stopRevisionWatch()
  if (askTimeout !== undefined) window.clearTimeout(askTimeout)
  sectionObserver?.disconnect()
  disposeAskResult?.()
  window.removeEventListener('focus', checkRevision)
  globalThis.document.removeEventListener('visibilitychange', checkRevision)
})
</script>

<template>
  <main v-if="loading" class="detail-state">Loading case…</main>
  <main v-else-if="error" class="detail-state error">{{ error }}</main>
  <main v-else-if="document" class="case-layout">
    <button class="outline-toggle" @click="outlineOpen = !outlineOpen">Outline</button>
    <aside class="outline" :class="{ open: outlineOpen }">
      <RouterLink
        :to="sessionId ? `/?session=${encodeURIComponent(sessionId)}&all=1` : '/'"
        class="back-link"
      >← All cases</RouterLink>
      <label class="search-box block-search">
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path d="M10.6 10.6 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <input v-model="blockQuery" type="search" placeholder="Search blocks" aria-label="Search blocks" />
      </label>
      <p class="outline-label">CONTENTS</p>
      <a
        v-for="entry in outline"
        :key="entry.id"
        :href="`#block-${entry.id}`"
        :class="{ active: entry.id === activeBlockId }"
        @click="outlineOpen = false"
      >
        <span>{{ String(entry.number).padStart(2, '0') }}</span>
        {{ entry.label }}
      </a>
      <p v-if="!blocks.length" class="outline-empty">No block matches “{{ blockQuery }}”.</p>
    </aside>

    <article class="case-document">
      <div v-if="pendingRevision || refreshError" class="update-notice">
        <template v-if="pendingRevision">
          <span>Case 已更新到 Revision {{ pendingRevision }}</span>
          <button @click="refreshContent">刷新内容</button>
        </template>
        <template v-else>
          <span>刷新失败：{{ refreshError }}</span>
          <button @click="refreshContent">重试</button>
        </template>
      </div>

      <header class="case-header">
        <div class="case-meta">
          <span>{{ document.type || 'exploration' }}</span>
          <span>{{ document.environment || 'environment not set' }}</span>
          <span>{{ document.status }}</span>
          <span v-if="linkedToSession" class="session-chip">
            当前会话关联 · Revision {{ document.revision }} · {{ document.status }}
          </span>
        </div>
        <h1>{{ document.title }}</h1>
        <p class="case-summary">{{ document.summary || 'No summary has been written yet.' }}</p>
        <div class="revision-line">
          <span>Revision {{ document.revision }}</span>
          <span>{{ document.blocks.length }} blocks</span>
          <span>{{ document.artifacts.length }} artifacts</span>
          <span>Updated {{ new Date(document.updatedAt).toLocaleString() }}</span>
          <span v-if="embedded">Embedded in DSH</span>
        </div>
        <div class="case-actions no-print">
          <button class="ghost" title="下载完整 JSON" @click="exportJson">Export JSON</button>
          <button class="ghost" title="下载 Markdown 摘要" @click="exportMarkdown">Export Markdown</button>
          <button class="ghost" title="打印 / 另存为 PDF" @click="printCase">Print</button>
        </div>
        <p v-if="sessionId && !linkedToSession" class="session-hint">
          当前 Session（{{ sessionId }}）尚未关联这个 Case。
          <template v-if="sessionLink?.activeCaseId">
            <RouterLink :to="`/cases/${sessionLink.activeCaseId}?session=${encodeURIComponent(sessionId)}`">
              打开当前会话的 Case →
            </RouterLink>
          </template>
        </p>
        <p v-else-if="sessionLinkError" class="session-hint error">{{ sessionLinkError }}</p>
      </header>

      <div class="blocks">
        <BlockRenderer
          v-for="block in blocks"
          :id="`block-${block.id}`"
          :key="block.id"
          :block="block"
          :artifacts="document.artifacts"
          @ask="openAsk"
        />
        <div v-if="!document.blocks.length" class="state-card empty">
          <h3>This case is ready for findings.</h3>
          <p>Use <code>tracebook_update</code> to add the first block.</p>
        </div>
        <div v-else-if="!blocks.length" class="state-card empty">
          <h3>No block matches this search.</h3>
          <button class="ghost" @click="blockQuery = ''">Clear search</button>
        </div>
      </div>

      <ArtifactPanel v-if="document.artifacts.length" :artifacts="document.artifacts" />
      <RevisionHistory :case-id="document.id" :current-revision="document.revision" />
    </article>

    <div v-if="askTarget" class="ask-backdrop" @click.self="closeAsk" @keydown.esc="closeAsk">
      <section
        ref="askDialog"
        class="ask-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-dialog-title"
        tabindex="-1"
        @keydown="trapFocus"
      >
        <header>
          <span class="evidence-kind">{{ askTarget.type }}</span>
          <h2 id="ask-dialog-title">Ask about this</h2>
          <button aria-label="Close" @click="closeAsk">×</button>
        </header>
        <p class="ask-target">{{ askTarget.blockId }} · {{ askTarget.id }}<template v-if="askTarget.label"> · {{ askTarget.label }}</template></p>
        <label class="ask-question">
          <span>你的问题（可留空）</span>
          <textarea v-model="askQuestion" rows="3" placeholder="这个服务后面还调用了谁？" />
        </label>
        <details class="ask-preview">
          <summary>预览将发送的上下文</summary>
          <pre>{{ askText }}</pre>
        </details>
        <p v-if="askStatus" class="ask-status">{{ askStatus }}</p>
        <p v-if="askError" class="ask-status error">{{ askError }}</p>
        <footer>
          <button class="ghost" @click="copyAsk">复制上下文</button>
          <button class="ghost" @click="closeAsk">取消</button>
          <button :disabled="askBusy" @click="submitAsk">
            {{ embedded ? '插入到当前对话' : '复制追问上下文' }}
          </button>
        </footer>
      </section>
    </div>
  </main>
</template>
