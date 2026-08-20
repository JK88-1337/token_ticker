import type { UsageSnapshot } from '../core/snapshot.js';

export interface FeedHandlers {
  snapshot: (snapshot: UsageSnapshot) => void;
  /** The transcript was written but nothing billable landed — work in progress. */
  activity: () => void;
  error: (message: string) => void;
}

/** The bridge the packaged app injects. Absent when running in a browser. */
declare global {
  interface Window {
    tokenTicker?: {
      subscribe(
        timeZone: string,
        onSnapshot: (snapshot: UsageSnapshot) => void,
        onActivity: () => void,
      ): () => void;
    };
  }
}

/**
 * Subscribes to usage, over whichever transport this build has.
 *
 * Packaged, the main process pushes over IPC; in development the dev server
 * pushes the same objects over SSE. The renderer is written against
 * {@link UsageSnapshot} and cannot tell the difference — which is the whole
 * reason aggregation happens before the boundary.
 */
export function subscribeToUsage(timeZone: string, handlers: FeedHandlers): () => void {
  const bridge = window.tokenTicker;
  if (bridge) {
    return bridge.subscribe(timeZone, handlers.snapshot, handlers.activity);
  }

  const source = new EventSource(`/api/usage/stream?tz=${encodeURIComponent(timeZone)}`);

  source.onmessage = (event) => handlers.snapshot(JSON.parse(event.data) as UsageSnapshot);
  source.addEventListener('activity', () => handlers.activity());
  // EventSource reconnects on its own, so this only matters before the first
  // snapshot ever arrives.
  source.onerror = () => handlers.error('waiting for the usage feed');

  return () => source.close();
}
