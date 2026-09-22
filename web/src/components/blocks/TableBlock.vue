<script setup lang="ts">
import { computed, ref } from 'vue'
import type { z } from 'zod'
import type { tableBlockSchema } from '../../../../src/core/model'

const props = defineProps<{ block: z.infer<typeof tableBlockSchema> }>()
const query = ref('')
const rows = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return needle ? props.block.rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle)) : props.block.rows
})
</script>

<template>
  <div class="table-tools"><input v-model="query" type="search" placeholder="Filter rows…" /></div>
  <div class="table-wrap">
    <table>
      <thead><tr><th v-for="column in block.columns" :key="column.key">{{ column.label }}</th></tr></thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="index">
          <td v-for="column in block.columns" :key="column.key">{{ row[column.key] }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
