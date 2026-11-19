import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const target = process.env.UNIGATE_CHAT_DEV_BACKEND ?? 'http://127.0.0.1:3081'

const viteConfig = defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    strictPort: true,
    proxy: { '/api': target, '/v1': target },
  },
})
export { viteConfig as default }
