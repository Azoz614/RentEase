import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Dev-only proxy target: the Node API (default) or `wrangler dev` (http://localhost:8787).
  const apiTarget = loadEnv(mode, process.cwd(), '').API_PROXY_TARGET || 'http://localhost:5000'
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/uploads': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
