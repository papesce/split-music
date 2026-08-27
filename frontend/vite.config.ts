import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': `${import.meta.dirname}/src`,
    },
  },
  server: {
    port: 5893,
    proxy: {
      '/upload': 'http://127.0.0.1:8087',
      '/split': 'http://127.0.0.1:8087',
      '/jobs': 'http://127.0.0.1:8087',
      '/segment': 'http://127.0.0.1:8087',
      '/export': 'http://127.0.0.1:8087',
      '/suggest': 'http://127.0.0.1:8087',
      '/transcribe': 'http://127.0.0.1:8087',
      '/lyrics': 'http://127.0.0.1:8087',
      '/health': 'http://127.0.0.1:8087',
      '/files': 'http://127.0.0.1:8087',
    },
  },
})
