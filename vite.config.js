import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PROTOTYPE_WEB_PORT || 5173),
    strictPort: true,
    headers: { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' },
    proxy: { '/api': `http://127.0.0.1:${process.env.PROTOTYPE_API_PORT || 3100}` },
  },
});
