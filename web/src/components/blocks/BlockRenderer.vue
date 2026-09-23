<script setup lang="ts">
import type { Artifact, Block } from '../../../../src/core/model'
import { computed, defineAsyncComponent, type Component } from 'vue'
import MarkdownBlock from './MarkdownBlock.vue'
import FactsBlock from './FactsBlock.vue'
import TableBlock from './TableBlock.vue'
import TimelineBlock from './TimelineBlock.vue'
import EvidenceBlock from './EvidenceBlock.vue'
import GalleryBlock from './GalleryBlock.vue'
import ApiBlock from './ApiBlock.vue'

const props = defineProps<{ block: Block; artifacts: Artifact[] }>()
const emit = defineEmits<{ ask: [selection: { blockId: string; type: 'node' | 'evidence' | 'api'; id: string; label?: string }] }>()

const FlowBlock = defineAsyncComponent(() => import('./FlowBlock.vue'))
const components: Record<Block['type'], Component> = {
  markdown: MarkdownBlock,
  facts: FactsBlock,
  flow: FlowBlock,
  table: TableBlock,
  timeline: TimelineBlock,
  evidence: EvidenceBlock,
  gallery: GalleryBlock,
  api: ApiBlock,
}

// A block whose type predates this viewer would otherwise render as an empty
// section; resolve leniently so an unknown type can fall back to its payload.
const resolved = computed(() => (components as Record<string, Component>)[props.block.type] as Component | undefined)
const rawPayload = computed(() => JSON.stringify(props.block, null, 2))

/** Attach the owning block, so the follow-up context names both selection and block. */
function forwardAsk(selection: { type: 'node' | 'evidence' | 'api'; id: string; label?: string }) {
  emit('ask', { blockId: props.block.id, ...selection })
}
</script>

<template>
  <section class="document-block">
    <div class="block-kicker"><span>{{ block.type }}</span><span>{{ block.id }}</span></div>
    <h2 v-if="block.title">{{ block.title }}</h2>
    <p v-if="block.description" class="block-description">{{ block.description }}</p>
    <component :is="resolved" v-if="resolved" :block="block" :artifacts="artifacts" @ask="forwardAsk" />
    <div v-else class="state-card empty">
      <h3>Unsupported block type “{{ block.type }}”</h3>
      <p>This viewer does not recognize this block yet; showing its raw payload.</p>
      <pre>{{ rawPayload }}</pre>
    </div>
  </section>
</template>
