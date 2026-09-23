<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Artifact } from '../../../src/core/model'
import { artifactUrl } from '../api'
import { isImageArtifact } from '../artifact-kind'

const props = defineProps<{ artifacts: Artifact[] }>()

/** Inline preview cap; anything past this is clipped and flagged as truncated. */
const PREVIEW_LIMIT = 20000

const kind = ref('')
const openId = ref('')
// Per-artifact state: one global flag would bleed a neighbour's loading/failure
// across cards as the reader opens them in turn.
const loading = ref<Record<string, boolean>>({})
const failure = ref<Record<string, string>>({})
const contents = ref<Record<string, string>>({})
const truncated = ref<Record<string, boolean>>({})
const imageFailed = ref<Record<string, boolean>>({})
/** Artifact id currently shown in the lightbox, empty when closed. */
const zoomed = ref('')

const kinds = computed(() => {
  const counts = new Map<string, number>()
  for (const artifact of props.artifacts) counts.set(artifact.kind, (counts.get(artifact.kind) ?? 0) + 1)
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})

const filtered = computed(() => (kind.value
  ? props.artifacts.filter((artifact) => artifact.kind === kind.value)
  : props.artifacts))

/** Text kinds get an inline `<pre>`; HAR is JSON, so it rides the text path too. */
const TEXT_KINDS = ['log', 'http', 'trace', 'code', 'json', 'text', 'xml', 'yaml', 'yml', 'csv', 'diff', 'patch', 'har']

function isPdf(artifact: Artifact) {
  return artifact.mimeType === 'application/pdf' || artifact.kind === 'pdf'
}

function isText(artifact: Artifact) {
  if (isImageArtifact(artifact) || isPdf(artifact)) return false
  const mime = artifact.mimeType ?? ''
  return mime.startsWith('text/')
    || /json|xml|yaml|csv|x-ndjson/.test(mime)
    || TEXT_KINDS.includes(artifact.kind)
}

function toggle(artifact: Artifact) {
  if (openId.value === artifact.id) { openId.value = ''; return }
  openId.value = artifact.id
  if (!isText(artifact) || contents.value[artifact.id] !== undefined) return
  loading.value = { ...loading.value, [artifact.id]: true }
  failure.value = { ...failure.value, [artifact.id]: '' }
  const url = artifactUrl(artifact.id)
  void fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Artifact read failed (${response.status})`)
      const text = await response.text()
      contents.value = { ...contents.value, [artifact.id]: text.slice(0, PREVIEW_LIMIT) }
      truncated.value = { ...truncated.value, [artifact.id]: text.length > PREVIEW_LIMIT }
    })
    .catch((reason: unknown) => {
      failure.value = { ...failure.value, [artifact.id]: reason instanceof Error ? reason.message : String(reason) }
    })
    .finally(() => { loading.value = { ...loading.value, [artifact.id]: false } })
}

function markImageFailed(id: string) {
  imageFailed.value = { ...imageFailed.value, [id]: true }
}
</script>

<template>
  <section class="artifact-panel">
    <div class="artifact-head">
      <h2>Artifacts</h2>
      <div class="artifact-filters">
        <button :class="{ active: kind === '' }" @click="kind = ''">All {{ artifacts.length }}</button>
        <button v-for="entry in kinds" :key="entry.name" :class="{ active: kind === entry.name }" @click="kind = entry.name">
          {{ entry.name }} {{ entry.count }}
        </button>
      </div>
    </div>
    <div v-if="filtered.length" class="artifact-grid">
      <article v-for="artifact in filtered" :key="artifact.id" class="artifact-card" :class="[`kind-${artifact.kind}`, { open: openId === artifact.id }]">
        <button class="artifact-open" @click="toggle(artifact)">
          <span class="evidence-kind">{{ artifact.kind }}</span>
          <strong>{{ artifact.name || artifact.id }}</strong>
          <small>{{ artifact.summary || artifact.mimeType || artifact.id }}</small>
        </button>
        <div v-if="openId === artifact.id" class="artifact-body">
          <template v-if="isImageArtifact(artifact)">
            <img
              v-if="!imageFailed[artifact.id]"
              :src="artifactUrl(artifact.id)"
              :alt="artifact.name || artifact.id"
              loading="lazy"
              style="cursor: zoom-in"
              @click="zoomed = artifact.id"
              @error="markImageFailed(artifact.id)"
            />
            <p v-else class="artifact-note error">Preview failed to load; open the original instead.</p>
          </template>
          <embed
            v-else-if="isPdf(artifact)"
            :src="artifactUrl(artifact.id)"
            type="application/pdf"
            style="width: 100%; height: 70vh; border: 0"
          />
          <p v-else-if="loading[artifact.id]" class="artifact-note">Loading…</p>
          <p v-else-if="failure[artifact.id]" class="artifact-note error">{{ failure[artifact.id] }}</p>
          <template v-else-if="contents[artifact.id] !== undefined">
            <pre>{{ contents[artifact.id] }}</pre>
            <p v-if="truncated[artifact.id]" class="artifact-note">
              Preview truncated at {{ PREVIEW_LIMIT.toLocaleString() }} characters —
              <a :href="artifactUrl(artifact.id)" target="_blank">view original ↗</a>
            </p>
          </template>
          <p v-else class="artifact-note">No inline preview for this type.</p>
          <a :href="artifactUrl(artifact.id)" target="_blank">Open raw ↗</a>
        </div>
      </article>
    </div>
    <p v-else class="artifact-note">No artifacts match this filter.</p>

    <!-- Click-to-zoom lightbox; a click anywhere (or Escape) dismisses it. -->
    <div
      v-if="zoomed"
      class="artifact-lightbox"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      style="position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: rgba(2, 6, 23, 0.8); cursor: zoom-out"
      @click="zoomed = ''"
      @keydown.esc="zoomed = ''"
    >
      <img :src="artifactUrl(zoomed)" :alt="zoomed" style="max-width: 92vw; max-height: 92vh; box-shadow: 0 18px 48px rgba(2, 6, 23, 0.6)" />
    </div>
  </section>
</template>
