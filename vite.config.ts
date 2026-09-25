import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  // Baked into the bundle so the running app can tell whether it is the
  // build the server would serve right now (src/stale-shell-guard.ts,
  // issue #311). STAMP_VERSION lets deploy tooling override this with a
  // stronger identifier (e.g. the release git SHA); it must match what
  // scripts/stamp-icons.cjs and scripts/write-version.cjs use.
  define: { __NOEVIA_BUILD__: JSON.stringify(process.env.STAMP_VERSION || pkg.version) },
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
