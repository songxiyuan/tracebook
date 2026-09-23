<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Artifact } from '../../../src/core/model'
import { artifactUrl } from '../api'
import { isImageArtifact } from '../artifact-kind'

const props = defineProps<{ artifacts: Artifact[] }>()

const kind = ref('')
const openId = ref('')
const loading = ref(false)
const failure = ref('')
const contents = ref<Record<string, string>>({})

const kinds = computed(() => {
  const counts = new Map<string, number>()
  for (const artifact of props.artifacts) counts.set(artifact.kind, (counts.get(artifact.kind) ?? 0) + 1)
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})

const filtered = computed(() => (kind.value
  ? props.artifacts.filter((artifact) => artifact.kind === kind.value)
  : props.artifacts))

function isText(artifact: Artifact) {
  if (isImageArtifact(artifact)) return false
  return artifact.mimeType?.startsWith('text/') === true
    || artifact.mimeType?.includes('json') === true
    || ['log', 'http', 'trace', 'code', 'json', 'text'].includes(artifact.kind)
}

function toggle(artifact: Artifact) {
  if (openId.value === artifact.id) { openId.value = ''; return }
  openId.value = artifact.id
  failure.value = ''
  if (!isText(artifact) || contents.value[artifact.id] !== undefined) return
  loading.value = true
  const url = artifactUrl(artifact.id)
  void fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Artifact read failed (${response.status})`)
      const text = await response.text()
      contents.value = { ...contents.value, [artifact.id]: text.slice(0, 20000) }
    })
    .catch((reason: unknown) => { failure.value = reason instanceof Error ? reason.message : String(reason) })
    .finally(() => { loading.value = false })
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
          <img v-if="isImageArtifact(artifact)" :src="artifactUrl(artifact.id)" :alt="artifact.name || artifact.id" loading="lazy" />
          <p v-else-if="loading" class="artifact-note">Loading…</p>
          <p v-else-if="failure" class="artifact-note error">{{ failure }}</p>
          <pre v-else-if="contents[artifact.id] !== undefined">{{ contents[artifact.id] }}</pre>
          <p v-else class="artifact-note">No inline preview for this type.</p>
          <a :href="artifactUrl(artifact.id)" target="_blank">Open raw ↗</a>
        </div>
      </article>
    </div>
    <p v-else class="artifact-note">No artifacts match this filter.</p>
  </section>
</template>
