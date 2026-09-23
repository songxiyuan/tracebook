<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Block, CaseRevisionSnapshot, CaseRevisionSummary } from '../../../src/core/model'
import { getRevisionSnapshot, listRevisions } from '../api'

const props = defineProps<{ caseId: string; currentRevision: number }>()

const revisions = ref<CaseRevisionSummary[]>([])
const baseRevision = ref<number>()
const targetRevision = ref<number>()
const base = ref<CaseRevisionSnapshot>()
const target = ref<CaseRevisionSnapshot>()
const loading = ref(true)
const error = ref('')
/** Kept apart from the list error so a failed side-load leaves the timeline readable. */
const diffError = ref('')

interface FieldChange {
  field: string
  before: string
  after: string
}

interface DiffEntry {
  id: string
  change: 'added' | 'removed' | 'changed'
  title?: string
  type?: string
  fields: FieldChange[]
}

const selected = computed(() => ({ base: baseRevision.value, target: targetRevision.value }))

/** Case-level metadata moves outside any block; surface title/status/summary edits on their own. */
const metaDiff = computed<FieldChange[]>(() => {
  if (!base.value || !target.value) return []
  const changes: FieldChange[] = []
  for (const field of ['title', 'status', 'summary'] as const) {
    const before = base.value[field] ?? ''
    const after = target.value[field] ?? ''
    if (before !== after) changes.push({ field, before: summarizeValue(before), after: summarizeValue(after) })
  }
  return changes
})

/** Compare two revisions by stable block id; titles and payload fields answer "what moved". */
const diff = computed<DiffEntry[]>(() => {
  if (!base.value || !target.value) return []
  const before = new Map(base.value.blocks.map((block) => [block.id, block]))
  const after = new Map(target.value.blocks.map((block) => [block.id, block]))
  const entries: DiffEntry[] = []
  for (const block of target.value.blocks) {
    const previous = before.get(block.id)
    if (!previous) {
      entries.push({ id: block.id, change: 'added', title: block.title, type: block.type, fields: [] })
      continue
    }
    const fields = changedFields(previous, block)
    if (fields.length) entries.push({ id: block.id, change: 'changed', title: block.title, type: block.type, fields })
  }
  for (const block of base.value.blocks) {
    if (!after.has(block.id)) {
      entries.push({ id: block.id, change: 'removed', title: block.title, type: block.type, fields: [] })
    }
  }
  return entries
})

/** Compact, human-readable form of a field value; arrays and objects never blow up a row. */
function summarizeValue(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 48 ? `${text.slice(0, 48)}…` : (text || '—')
}

/**
 * Field-level diff for one block, keeping the before→after values (not just the
 * names). A block's `artifactRefs` are ordinary fields, so artifact changes ride
 * along here; case-level artifacts are not part of a revision snapshot.
 */
function changedFields(before: Block, after: Block): FieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: FieldChange[] = []
  for (const key of keys) {
    if (key === 'updatedAt') continue
    const left = (before as unknown as Record<string, unknown>)[key]
    const right = (after as unknown as Record<string, unknown>)[key]
    if (JSON.stringify(left) === JSON.stringify(right)) continue
    changed.push({ field: key, before: summarizeValue(left), after: summarizeValue(right) })
  }
  return changed
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await listRevisions(props.caseId)
    revisions.value = result.revisions
    const available = new Set(result.revisions.map((item) => item.revision))
    const newest = result.revisions[0]
    const previous = result.revisions[1] ?? newest
    // Keep the reader's chosen comparison across refreshes; only re-anchor on the
    // newest pair when a side is unset or the picked revision no longer exists.
    if (targetRevision.value === undefined || !available.has(targetRevision.value)) {
      targetRevision.value = newest?.revision
    }
    if (baseRevision.value === undefined || !available.has(baseRevision.value)) {
      baseRevision.value = previous?.revision
    }
    await loadSides()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

// A late snapshot response must not overwrite a newer request's result.
let sidesToken = 0
async function loadSides() {
  const token = ++sidesToken
  diffError.value = ''
  try {
    const [left, right] = await Promise.all([
      baseRevision.value === undefined ? undefined : getRevisionSnapshot(props.caseId, baseRevision.value),
      targetRevision.value === undefined ? undefined : getRevisionSnapshot(props.caseId, targetRevision.value),
    ])
    if (token !== sidesToken) return
    base.value = left
    target.value = right
  } catch (reason) {
    if (token !== sidesToken) return
    diffError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function pick(side: 'base' | 'target', revision: number) {
  if (side === 'base') baseRevision.value = revision
  else targetRevision.value = revision
  await loadSides()
}

function swap() {
  const previous = baseRevision.value
  baseRevision.value = targetRevision.value
  targetRevision.value = previous
  void loadSides()
}

onMounted(load)
// A pulled-in revision is new content: re-read the list and re-anchor the
// comparison on the newest pair rather than leaving the panel stale.
watch(() => props.currentRevision, load)
</script>

<template>
  <section class="history-panel">
    <div class="history-head">
      <h2>Revision history</h2>
      <button class="ghost" @click="load">Reload</button>
    </div>
    <p v-if="loading" class="artifact-note">Loading history…</p>
    <p v-else-if="error" class="artifact-note error">{{ error }}</p>
    <p v-else-if="!revisions.length" class="artifact-note">
      No revision history is stored for this case yet; the next update starts it.
    </p>
    <template v-else>
      <ol class="history-list">
        <li v-for="revision in revisions" :key="revision.revision">
          <span class="revision-chip" :class="{ current: revision.revision === currentRevision }">r{{ revision.revision }}</span>
          <div>
            <strong>{{ revision.summary || 'No summary at this revision.' }}</strong>
            <small>{{ revision.blockCount }} blocks · {{ new Date(revision.updatedAt).toLocaleString() }}</small>
          </div>
          <div class="history-picks">
            <button :class="{ active: baseRevision === revision.revision }" @click="pick('base', revision.revision)">Base</button>
            <button :class="{ active: targetRevision === revision.revision }" @click="pick('target', revision.revision)">Compare</button>
          </div>
        </li>
      </ol>

      <div class="history-diff">
        <div class="history-diff-head">
          <strong>r{{ baseRevision }} → r{{ targetRevision }}</strong>
          <span v-if="selected.base === selected.target" class="artifact-note">Pick two different revisions.</span>
          <button class="ghost" @click="swap">Swap</button>
        </div>
        <p v-if="diffError" class="artifact-note error">{{ diffError }}</p>
        <template v-else>
          <ul v-if="metaDiff.length" class="diff-list">
            <li v-for="change in metaDiff" :key="change.field" class="changed">
              <span class="diff-badge">meta</span>
              <code>{{ change.field }}</code>
              <span>{{ change.before }} → {{ change.after }}</span>
            </li>
          </ul>
          <ul v-if="diff.length" class="diff-list">
            <li v-for="entry in diff" :key="entry.id" :class="entry.change">
              <span class="diff-badge">{{ entry.change }}</span>
              <code>{{ entry.id }}</code>
              <span>{{ entry.title || entry.type }}</span>
              <ul v-if="entry.fields.length" class="diff-fields">
                <li v-for="field in entry.fields" :key="field.field">
                  <code>{{ field.field }}</code> {{ field.before }} → {{ field.after }}
                </li>
              </ul>
            </li>
          </ul>
          <p v-if="!metaDiff.length && !diff.length && selected.base !== selected.target" class="artifact-note">
            No differences between these revisions.
          </p>
        </template>
      </div>
    </template>
  </section>
</template>
