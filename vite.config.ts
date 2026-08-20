import react from '@vitejs/plugin-react';
import type { ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { defaultPricingTable } from './src/core/pricing.js';
import { watchTree } from './src/node/feed.js';
import { UsageStore } from './src/node/store.js';
import { defaultTranscriptRoot } from './src/node/transcripts.js';

/** Bursts of appends settle into one rebuild. */
const SETTLE_MS = 120;
/** A backstop in case the watcher misses something. */
const SWEEP_MS = 5_000;
/** Keeps idle connections and proxies from timing the stream out. */
const KEEPALIVE_MS = 15_000;

/**
 * Serves the usage snapshot to the dev server, and streams it.
 *
 * This is the development half of the boundary the snapshot was designed for.
 * When the app is packaged, Electron's main process replaces this middleware
 * with an IPC channel over the same `UsageStore` — the renderer keeps
 * receiving a `UsageSnapshot` either way.
 *
 * Updates are pushed from a filesystem watcher rather than polled, so a turn
 * reaches the screen about as fast as Claude Code can write it.
 */
function usageApi(): Plugin {
  const root = defaultTranscriptRoot();
  const store = new UsageStore(root);
  const clients = new Set<{ res: ServerResponse; timeZone: string }>();

  let refreshing: Promise<boolean> | null = null;

  /** Refreshes once even if several triggers land together. */
  function refresh(): Promise<boolean> {
    refreshing ??= store
      .refresh()
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  function send(client: { res: ServerResponse; timeZone: string }): void {
    const snapshot = store.snapshot(defaultPricingTable, client.timeZone);
    client.res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  }

  async function broadcast(force = false): Promise<void> {
    if (clients.size === 0) return;
    const changed = await refresh();

    if (!changed && !force) {
      // The transcript was written but carried nothing billable — a tool
      // result, a user line, a turn still being generated. Worth saying so:
      // it is evidence of work, and it is not a token count.
      const beat = `event: activity
data: {"at":${Date.now()}}

`;
      for (const client of clients) client.res.write(beat);
      return;
    }

    for (const client of clients) send(client);
  }

  return {
    name: 'token-ticker-usage-api',

    configureServer(server) {
      const stopWatching = watchTree(root, SETTLE_MS, () => void broadcast());
      const sweep = setInterval(() => void broadcast(), SWEEP_MS);
      const keepalive = setInterval(() => {
        for (const client of clients) client.res.write(': keepalive\n\n');
      }, KEEPALIVE_MS);

      server.httpServer?.once('close', () => {
        stopWatching();
        clearInterval(sweep);
        clearInterval(keepalive);
        for (const client of clients) client.res.end();
        clients.clear();
      });

      server.middlewares.use('/api/usage', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        // The browser knows the viewer's zone; the server only has its own.
        const timeZone = url.searchParams.get('tz') || 'UTC';

        if (!url.pathname.startsWith('/stream')) {
          refresh()
            .then(() => {
              res.setHeader('content-type', 'application/json; charset=utf-8');
              res.setHeader('cache-control', 'no-store');
              res.end(JSON.stringify(store.snapshot(defaultPricingTable, timeZone)));
            })
            .catch((error: unknown) => {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(error) }));
            });
          return;
        }

        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });

        const client = { res, timeZone };
        clients.add(client);
        req.on('close', () => clients.delete(client));

        // Whoever just connected needs the current state, changed or not.
        refresh()
          .then(() => send(client))
          .catch(() => res.end());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), usageApi()],
  server: { port: 5273 },
  build: { outDir: 'dist' },
});
