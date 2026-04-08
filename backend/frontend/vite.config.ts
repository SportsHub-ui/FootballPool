import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3000'

  return {
    plugins: [react()],
    server: {
      host: true,        // expose dev server on LAN
      port: 5173,
      watch: {
        usePolling: true // required for Pi auto-refresh
      },
      proxy: {
        '/api': proxyTarget,
        '/images': proxyTarget,
      },
    },
  }
})
