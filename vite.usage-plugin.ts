import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
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
 * Serves the usage snapshot to a Vite dev server, and streams it.
 *
 * Shared by the original dashboard and the arcade prototype so both ports
 * read the same transcripts.
 */
export function usageApi(): Plugin {
  const root = defaultTranscriptRoot();
  const store = new UsageStore(root);
  const clients = new Set<{ res: ServerResponse; timeZone: string }>();

  let refreshing: Promise<boolean> | null = null;

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

        refresh()
          .then(() => send(client))
          .catch(() => res.end());
      });
    },
  };
}
