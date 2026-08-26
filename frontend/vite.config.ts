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
    proxy: {
      '/upload': 'http://127.0.0.1:8000',
      '/split': 'http://127.0.0.1:8000',
      '/segment': 'http://127.0.0.1:8000',
      '/export': 'http://127.0.0.1:8000',
      '/transcribe': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
    },
  },
})
