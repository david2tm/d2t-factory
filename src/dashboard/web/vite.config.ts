// The dashboard board (2-2). `npm run build` writes the committed dashboard/dist, which the 2-1
// server serves. `npm run dev` proxies /api to a running dashboard server (FACTORY_DASHBOARD_PORT,
// default 4870); the browser bundle itself never names a host.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const port = Number(process.env.FACTORY_DASHBOARD_PORT) || 4870;

export default defineConfig({
  plugins: [svelte()],
  base: '/',
  build: {
    outDir: '../../../dashboard/dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  server: {
    proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true } },
  },
});
