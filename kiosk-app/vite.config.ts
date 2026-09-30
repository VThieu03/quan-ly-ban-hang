import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true, // cho điện thoại trong cùng mạng wifi truy cập được khi dev
    allowedHosts: ['.trycloudflare.com'], // link thử qua Cloudflare Tunnel
    proxy: { '/api': 'http://localhost:3000', '/uploads': 'http://localhost:3000' },
  },
})
