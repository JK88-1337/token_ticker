import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { usageApi } from './vite.usage-plugin.js';

/** Arcade lives at arcade.html; rewrite `/` so the port opens on the skin. */
function arcadeIndex(): Plugin {
  return {
    name: 'arcade-index',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split('?')[0];
        if (path === '/' || path === '/index.html') req.url = '/arcade.html';
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [arcadeIndex(), react(), usageApi()],
  server: {
    port: 7777,
    strictPort: true,
    open: '/arcade.html',
  },
});
