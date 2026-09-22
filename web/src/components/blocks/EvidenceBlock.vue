<script setup lang="ts">
import type { Artifact } from '../../../../src/core/model'
import type { z } from 'zod'
import type { evidenceBlockSchema } from '../../../../src/core/model'
import { artifactUrl } from '../../api'
defineProps<{ block: z.infer<typeof evidenceBlockSchema>; artifacts: Artifact[] }>()
const emit = defineEmits<{ ask: [selection: { type: 'evidence'; id: string; label?: string }] }>()
</script>

<template>
  <div class="evidence-grid">
    <article v-for="item in block.items" :key="item.id" class="evidence-card">
      <span class="evidence-kind">{{ item.kind }}</span>
      <h3>{{ item.title }}</h3>
      <p v-if="item.summary">{{ item.summary }}</p>
      <a v-if="item.artifactRef" :href="artifactUrl(item.artifactRef)" target="_blank">Open artifact ↗</a>
      <button class="ask-button" @click="emit('ask', { type: 'evidence', id: item.id, label: item.title })">
        Ask about this
      </button>
    </article>
  </div>
</template>
