// @ts-ignore — @tailwindcss/vite ships its own types
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': `${import.meta.dirname}/src` },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/upload': 'http://127.0.0.1:8000',
      '/split': 'http://127.0.0.1:8000',
      '/segment': 'http://127.0.0.1:8000',
      '/transcribe': 'http://127.0.0.1:8000',
      '/export': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
    },
  },
})
