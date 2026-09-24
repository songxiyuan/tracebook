<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <main class="list-page">
    <div class="state-card empty not-found">
      <p class="not-found-code">404</p>
      <h3>Page not found</h3>
      <p>没有找到 <code>{{ route.fullPath }}</code> 对应的页面。它可能已被删除，或链接已过期。</p>
      <RouterLink class="ghost" to="/?all=1">Back to all cases</RouterLink>
    </div>
  </main>
</template>

<style scoped>
.not-found { align-items: center; text-align: center; gap: 8px; }
.not-found-code {
  margin: 0;
  color: var(--frontend);
  font: 700 40px/1 var(--font-mono);
  letter-spacing: .06em;
}
.not-found code { overflow-wrap: anywhere; }
.not-found .ghost { margin-top: 6px; text-decoration: none; }
</style>
