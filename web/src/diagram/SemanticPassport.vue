<script setup lang="ts">
import type { Passport } from './graph-analysis'

const props = defineProps<{ passport: Passport; reachDir: 'up' | 'down' | null; copied: boolean }>()
const emit = defineEmits<{
  close: []
  copy: []
  focus: [id: string]
  reach: [dir: 'up' | 'down' | null]
}>()

function toggleReach(dir: 'up' | 'down') {
  emit('reach', props.reachDir === dir ? null : dir)
}
</script>

<template>
  <aside class="passport" aria-label="语义护照">
    <header class="passport-head">
      <div>
        <p class="passport-eyebrow">语义护照</p>
        <h3 class="passport-title">{{ passport.node.label }}</h3>
        <p v-if="passport.node.sublabel" class="passport-sub">{{ passport.node.sublabel }}</p>
      </div>
      <button class="passport-x" aria-label="Close" @click="emit('close')">×</button>
    </header>

    <div class="passport-meta">
      <span v-if="passport.node.kind" class="passport-chip kind" :class="`kind-${passport.node.kind}`"><i class="swatch" />{{ passport.node.kind }}</span>
      <span v-if="passport.node.tag" class="passport-chip">{{ passport.node.tag }}</span>
      <code class="passport-id">{{ passport.node.id }}</code>
    </div>

    <p class="passport-summary">
      {{ passport.outgoing.length }} 条出向 · {{ passport.incoming.length }} 条入向<template v-if="passport.loops"> · {{ passport.loops }} 自环</template>
    </p>

    <div class="passport-reach">
      <button :class="{ active: reachDir === 'up' }" @click="toggleReach('up')">
        <small>上游</small><strong>{{ passport.upstreamCount }}</strong>
      </button>
      <button :class="{ active: reachDir === 'down' }" @click="toggleReach('down')">
        <small>下游</small><strong>{{ passport.downstreamCount }}</strong>
      </button>
    </div>

    <div v-if="passport.outgoing.length" class="passport-group">
      <p class="passport-group-label">出向 · {{ passport.outgoing.length }}</p>
      <button v-for="(edge, index) in passport.outgoing" :key="`out-${index}`" class="passport-row" @click="emit('focus', edge.id)">
        <span class="passport-dir">出 →</span>
        <span class="passport-row-body"><strong>{{ edge.label }}</strong><small v-if="edge.edgeLabel">{{ edge.edgeLabel }}</small></span>
      </button>
    </div>

    <div v-if="passport.incoming.length" class="passport-group">
      <p class="passport-group-label">入向 · {{ passport.incoming.length }}</p>
      <button v-for="(edge, index) in passport.incoming" :key="`in-${index}`" class="passport-row" @click="emit('focus', edge.id)">
        <span class="passport-dir">← 入</span>
        <span class="passport-row-body"><strong>{{ edge.label }}</strong><small v-if="edge.edgeLabel">{{ edge.edgeLabel }}</small></span>
      </button>
    </div>

    <footer class="passport-actions">
      <button class="passport-link" @click="emit('copy')">{{ copied ? '✓ 已复制' : '复制链接' }}</button>
      <slot name="actions" />
    </footer>
  </aside>
</template>

<style scoped>
.passport {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(320px, calc(100% - 24px));
  max-height: calc(100% - 24px);
  overflow: auto;
  padding: 12px 14px 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--panel) 97%, transparent);
  box-shadow: 0 18px 48px rgba(2, 6, 23, .18);
}
.passport-head { display: flex; align-items: flex-start; gap: 8px; }
.passport-head > div { flex: 1; min-width: 0; }
.passport-eyebrow { margin: 0; color: var(--frontend); font: 600 9px/1.4 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.passport-title { margin: 2px 0 0; font: 700 15px/1.3 var(--font-sans); color: var(--ink-strong); overflow-wrap: anywhere; }
.passport-sub { margin: 2px 0 0; color: var(--muted); font: 500 10px/1.4 var(--font-mono); }
.passport-x { border: 0; background: none; color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; }
.passport-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.passport-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px;
  border: 1px solid var(--line); border-radius: var(--r-pill);
  color: var(--muted); font: 600 9.5px/1.6 var(--font-mono); text-transform: uppercase; letter-spacing: .04em;
}
.passport-chip.kind { border-color: var(--kind, var(--line)); color: var(--kind, var(--muted)); }
.passport-chip .swatch { width: 8px; height: 8px; border-radius: 2px; background: var(--kind, var(--external)); }
.passport-id { padding: 1px 6px; border-radius: var(--r-sm); background: var(--panel-2); color: var(--dim); font: 500 10px/1.6 var(--font-mono); }
.passport-summary { margin: 0; color: var(--muted); font: 500 11px/1.4 var(--font-mono); }
.passport-reach { display: flex; gap: 8px; }
.passport-reach button {
  flex: 1; display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--panel-2); color: var(--ink); cursor: pointer;
}
.passport-reach button.active { border-color: var(--frontend); color: var(--frontend); }
.passport-reach small { font: 500 9px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.passport-reach button.active small { color: var(--frontend); }
.passport-reach strong { font: 700 15px/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.passport-group { border-top: 1px solid var(--line); padding-top: 6px; }
.passport-group-label { margin: 0 0 4px; color: var(--dim); font: 600 9px/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; }
.passport-row { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 4px 2px; border: 0; background: none; text-align: left; cursor: pointer; border-radius: var(--r-sm); }
.passport-row:hover { background: var(--panel-2); }
.passport-dir { color: var(--dim); font: 600 8.5px/1.6 var(--font-mono); white-space: nowrap; }
.passport-row-body { min-width: 0; }
.passport-row-body strong { display: block; font: 600 11.5px/1.3 var(--font-sans); color: var(--ink-strong); overflow-wrap: anywhere; }
.passport-row-body small { color: var(--muted); font: 400 10px/1.4 var(--font-mono); }
.passport-actions { display: flex; flex-wrap: wrap; gap: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
.passport-link { padding: 2px 8px; border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--panel-2); color: var(--frontend); font: 600 10px/1.6 var(--font-mono); cursor: pointer; }
.passport-link:hover { border-color: var(--frontend); }
</style>
