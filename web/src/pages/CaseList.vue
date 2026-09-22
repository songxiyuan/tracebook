<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { listCases } from '../api'
import type { CaseSummary } from '../../../src/core/model'

const cases = ref<CaseSummary[]>([])
const query = ref('')
const loading = ref(true)
const error = ref('')

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return cases.value
  return cases.value.filter((item) => JSON.stringify(item).toLowerCase().includes(needle))
})

onMounted(async () => {
  try { cases.value = await listCases() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { loading.value = false }
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
        <strong>{{ cases.length }}</strong>
        <span>cases documented</span>
      </div>
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
        <RouterLink v-for="item in filtered" :key="item.id" class="case-card" :to="`/cases/${item.id}`">
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
