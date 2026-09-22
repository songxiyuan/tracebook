<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { z } from 'zod'
import type { markdownBlockSchema } from '../../../../src/core/model'

const props = defineProps<{ block: z.infer<typeof markdownBlockSchema> }>()
const content = computed(() => DOMPurify.sanitize(marked.parse(props.block.content) as string))
</script>

<template><div class="markdown-body" v-html="content" /></template>
