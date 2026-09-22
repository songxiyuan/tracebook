<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getCase } from '../api'
import BlockRenderer from '../components/blocks/BlockRenderer.vue'
import type { CaseDocument } from '../../../src/core/model'

const route = useRoute()
const document = ref<CaseDocument>()
const loading = ref(true)
const error = ref('')
const outlineOpen = ref(false)

const caseId = computed(() => String(route.params.id))
async function load() {
  loading.value = true
  error.value = ''
  try { document.value = await getCase(caseId.value) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { loading.value = false }
}
onMounted(load)
watch(caseId, load)
</script>

<template>
  <main v-if="loading" class="detail-state">Loading case…</main>
  <main v-else-if="error" class="detail-state error">{{ error }}</main>
  <main v-else-if="document" class="case-layout">
    <button class="outline-toggle" @click="outlineOpen = !outlineOpen">Outline</button>
    <aside class="outline" :class="{ open: outlineOpen }">
      <RouterLink to="/" class="back-link">← All cases</RouterLink>
      <p class="outline-label">CONTENTS</p>
      <a v-for="(block, index) in document.blocks" :key="block.id" :href="`#block-${block.id}`" @click="outlineOpen = false">
        <span>{{ String(index + 1).padStart(2, '0') }}</span>
        {{ block.title || block.type }}
      </a>
    </aside>

    <article class="case-document">
      <header class="case-header">
        <div class="case-meta">
          <span>{{ document.type || 'exploration' }}</span>
          <span>{{ document.environment || 'environment not set' }}</span>
          <span>{{ document.status }}</span>
        </div>
        <h1>{{ document.title }}</h1>
        <p class="case-summary">{{ document.summary || 'No summary has been written yet.' }}</p>
        <div class="revision-line">
          <span>Revision {{ document.revision }}</span>
          <span>Updated {{ new Date(document.updatedAt).toLocaleString() }}</span>
        </div>
      </header>

      <div class="blocks">
        <BlockRenderer
          v-for="block in document.blocks"
          :id="`block-${block.id}`"
          :key="block.id"
          :block="block"
          :artifacts="document.artifacts"
        />
        <div v-if="!document.blocks.length" class="state-card empty">
          <h3>This case is ready for findings.</h3>
          <p>Use <code>tracebook_update</code> to add the first block.</p>
        </div>
      </div>
    </article>
  </main>
</template>
