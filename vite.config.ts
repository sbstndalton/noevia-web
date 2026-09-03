import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev server proxies API calls to the local proxy server (npm start in
      // another terminal, or point UI_PROXY_TARGET at a deployed instance).
      '/api': {
        target: process.env.UI_PROXY_TARGET || 'http://localhost:8021',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist' },
});
