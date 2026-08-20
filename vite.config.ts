import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { defaultPricingTable } from './src/core/pricing.js';
import { UsageStore } from './src/node/store.js';
import { defaultTranscriptRoot } from './src/node/transcripts.js';

/**
 * Serves the usage snapshot to the dev server.
 *
 * This is the development half of the boundary the snapshot was designed for.
 * When the app is packaged, Electron's main process replaces this middleware
 * with an IPC handler over the same `UsageStore` — the renderer keeps asking
 * for a `UsageSnapshot` either way.
 */
function usageApi(): Plugin {
  const store = new UsageStore(defaultTranscriptRoot());

  return {
    name: 'token-ticker-usage-api',
    configureServer(server) {
      server.middlewares.use('/api/usage', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        // The browser knows the viewer's zone; the server only has its own.
        const timeZone = url.searchParams.get('tz') || 'UTC';

        store
          .refresh()
          .then(() => {
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(JSON.stringify(store.snapshot(defaultPricingTable, timeZone)));
          })
          .catch((error: unknown) => {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: String(error) }));
          });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), usageApi()],
  server: { port: 5273 },
  build: { outDir: 'dist' },
});
