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

interface DiffEntry {
  id: string
  change: 'added' | 'removed' | 'changed'
  title?: string
  type?: string
  fields: string[]
}

const selected = computed(() => ({ base: baseRevision.value, target: targetRevision.value }))

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

function changedFields(before: Block, after: Block): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const key of keys) {
    if (key === 'updatedAt') continue
    const left = (before as unknown as Record<string, unknown>)[key]
    const right = (after as unknown as Record<string, unknown>)[key]
    if (JSON.stringify(left) === JSON.stringify(right)) continue
    changed.push(Array.isArray(left) && Array.isArray(right) ? `${key} ${left.length}→${right.length}` : key)
  }
  return changed
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await listRevisions(props.caseId)
    revisions.value = result.revisions
    const newest = result.revisions[0]
    const previous = result.revisions[1] ?? newest
    targetRevision.value = newest?.revision
    baseRevision.value = previous?.revision
    await loadSides()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function loadSides() {
  const [left, right] = await Promise.all([
    baseRevision.value === undefined ? undefined : getRevisionSnapshot(props.caseId, baseRevision.value),
    targetRevision.value === undefined ? undefined : getRevisionSnapshot(props.caseId, targetRevision.value),
  ])
  base.value = left
  target.value = right
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
        <ul v-if="diff.length" class="diff-list">
          <li v-for="entry in diff" :key="entry.id" :class="entry.change">
            <span class="diff-badge">{{ entry.change }}</span>
            <code>{{ entry.id }}</code>
            <span>{{ entry.title || entry.type }}</span>
            <small v-if="entry.fields.length">changed: {{ entry.fields.join(', ') }}</small>
          </li>
        </ul>
        <p v-else-if="selected.base !== selected.target" class="artifact-note">No block-level differences between these revisions.</p>
      </div>
    </template>
  </section>
</template>
