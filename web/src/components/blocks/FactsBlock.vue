<script setup lang="ts">
import type { z } from 'zod'
import type { factsBlockSchema } from '../../../../src/core/model'
defineProps<{ block: z.infer<typeof factsBlockSchema> }>()
</script>

<template>
  <dl class="facts-grid">
    <div v-for="item in block.items" :key="item.label">
      <dt>{{ item.label }}</dt><dd>{{ item.value }}</dd>
    </div>
  </dl>
</template>
