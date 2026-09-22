<script setup lang="ts">
import type { z } from 'zod'
import type { timelineBlockSchema } from '../../../../src/core/model'
defineProps<{ block: z.infer<typeof timelineBlockSchema> }>()
</script>

<template>
  <ol class="timeline">
    <li v-for="(item, index) in block.items" :key="`${item.title}-${index}`">
      <span class="timeline-index">{{ String(index + 1).padStart(2, '0') }}</span>
      <div><time v-if="item.timestamp">{{ item.timestamp }}</time><h3>{{ item.title }}</h3><p v-if="item.description">{{ item.description }}</p></div>
    </li>
  </ol>
</template>
