<script setup lang="ts">
import type { Artifact, Block } from '../../../../src/core/model'
import { computed, defineAsyncComponent, ref, type Component } from 'vue'
import MarkdownBlock from './MarkdownBlock.vue'
import FactsBlock from './FactsBlock.vue'
import TableBlock from './TableBlock.vue'
import TimelineBlock from './TimelineBlock.vue'
import EvidenceBlock from './EvidenceBlock.vue'
import GalleryBlock from './GalleryBlock.vue'
import ApiBlock from './ApiBlock.vue'
import SequenceBlock from './SequenceBlock.vue'
import { blockLink, copyText } from '../../clipboard'

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
  sequence: SequenceBlock,
}

// A block whose type predates this viewer would otherwise render as an empty
// section; resolve leniently so an unknown type can fall back to its payload.
const resolved = computed(() => (components as Record<string, Component>)[props.block.type] as Component | undefined)
const rawPayload = computed(() => JSON.stringify(props.block, null, 2))

const copied = ref(false)
/** Copy a shareable deep link to this block's scroll anchor. */
async function copyLink() {
  if (await copyText(blockLink(props.block.id))) {
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  }
}

/** Attach the owning block, so the follow-up context names both selection and block. */
function forwardAsk(selection: { type: 'node' | 'evidence' | 'api'; id: string; label?: string }) {
  emit('ask', { blockId: props.block.id, ...selection })
}
</script>

<template>
  <section class="document-block">
    <div class="block-kicker">
      <span>{{ block.type }}</span>
      <span>{{ block.id }}</span>
      <button class="block-link no-print" :title="copied ? '链接已复制' : '复制到此块的链接'" @click="copyLink">
        {{ copied ? '✓ Linked' : '🔗 Link' }}
      </button>
    </div>
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

<style scoped>
.block-link {
  padding: 1px 7px;
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  background: var(--panel-2);
  color: var(--muted);
  font: 600 9px/1.5 var(--font-mono);
  letter-spacing: .04em;
  cursor: pointer;
}
.block-link:hover { border-color: var(--frontend); color: var(--frontend); }
</style>

