<script setup lang="ts">
import { SHORTCUTS, useShortcuts } from './shortcuts'

const { helpOpen } = useShortcuts()
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <!-- `all=1` forces the full library; a bare `/` would bounce a session
           reader straight back to their active case. -->
      <RouterLink class="brand" to="/?all=1">
        <span class="brand-mark">T</span>
        <span>Tracebook</span>
      </RouterLink>
      <span class="tagline">Engineering investigation notebook</span>
      <span class="topbar-spacer" />
      <button class="topbar-help" title="键盘快捷键 (?)" aria-label="Keyboard shortcuts" @click="helpOpen = true">?</button>
    </header>
    <RouterView />

    <div
      v-if="helpOpen"
      class="shortcut-backdrop"
      @click.self="helpOpen = false"
      @keydown.esc="helpOpen = false"
    >
      <section class="shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-title" tabindex="-1">
        <header>
          <h2 id="shortcut-title">Keyboard shortcuts</h2>
          <button aria-label="Close" @click="helpOpen = false">×</button>
        </header>
        <dl class="shortcut-list">
          <div v-for="entry in SHORTCUTS" :key="entry.keys">
            <dt><kbd v-for="key in entry.keys.split(' ')" :key="key">{{ key }}</kbd></dt>
            <dd>{{ entry.description }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </div>
</template>
