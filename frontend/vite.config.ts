import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev la UI gira su :5173 e proxya /api al hub (:4600), che a sua volta
// parla coi backend. In produzione i file statici li serve il hub stesso.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:4600', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
})