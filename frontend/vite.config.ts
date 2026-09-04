import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// In dev la UI gira su :5173 e proxya /api al hub (:4600), che a sua volta
// parla coi backend. In produzione i file statici li serve il hub stesso.
export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:4600', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
})