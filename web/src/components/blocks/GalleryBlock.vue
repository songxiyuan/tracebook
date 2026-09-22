<script setup lang="ts">
import type { Artifact } from '../../../../src/core/model'
import type { z } from 'zod'
import type { galleryBlockSchema } from '../../../../src/core/model'
import { artifactUrl } from '../../api'
defineProps<{ block: z.infer<typeof galleryBlockSchema>; artifacts: Artifact[] }>()
</script>

<template>
  <div class="gallery-grid">
    <figure v-for="item in block.items" :key="item.artifactRef">
      <a :href="artifactUrl(item.artifactRef)" target="_blank">
        <img :src="artifactUrl(item.artifactRef)" :alt="item.caption || item.artifactRef" loading="lazy" />
      </a>
      <figcaption>{{ item.caption || item.artifactRef }}</figcaption>
    </figure>
  </div>
</template>
