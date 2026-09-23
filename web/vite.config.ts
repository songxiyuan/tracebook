import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/tracebook/',
  plugins: [vue({
    template: {
      compilerOptions: {
        // The HAR waterfall is a light-DOM custom element, not a Vue component.
        isCustomElement: (tag) => tag === 'waterfall-chart',
      },
    },
  })],
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
})
