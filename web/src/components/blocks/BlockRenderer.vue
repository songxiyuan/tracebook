<script setup lang="ts">
import type { Artifact, Block } from '../../../../src/core/model'
import { defineAsyncComponent, type Component } from 'vue'
import MarkdownBlock from './MarkdownBlock.vue'
import FactsBlock from './FactsBlock.vue'
import TableBlock from './TableBlock.vue'
import TimelineBlock from './TimelineBlock.vue'
import EvidenceBlock from './EvidenceBlock.vue'
import GalleryBlock from './GalleryBlock.vue'

defineProps<{ block: Block; artifacts: Artifact[] }>()
const FlowBlock = defineAsyncComponent(() => import('./FlowBlock.vue'))
const components: Record<Block['type'], Component> = {
  markdown: MarkdownBlock,
  facts: FactsBlock,
  flow: FlowBlock,
  table: TableBlock,
  timeline: TimelineBlock,
  evidence: EvidenceBlock,
  gallery: GalleryBlock,
}
</script>

<template>
  <section class="document-block">
    <div class="block-kicker"><span>{{ block.type }}</span><span>{{ block.id }}</span></div>
    <h2 v-if="block.title">{{ block.title }}</h2>
    <p v-if="block.description" class="block-description">{{ block.description }}</p>
    <component :is="components[block.type]" :block="block" :artifacts="artifacts" />
  </section>
</template>
