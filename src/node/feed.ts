import { watch, type FSWatcher } from 'node:fs';

/**
 * Calls back when anything under a directory tree changes.
 *
 * Writes arrive in bursts — one turn appends several lines — so notifications
 * are coalesced into a single call after the tree goes quiet for `settleMs`.
 * Without that a burst would rebuild the snapshot once per line.
 */
export function watchTree(root: string, settleMs: number, onChange: () => void): () => void {
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;

  const settle = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, settleMs);
  };

  try {
    watcher = watch(root, { recursive: true, persistent: false }, settle);
  } catch {
    // No transcripts directory yet, or a platform without recursive watching.
    // The caller's polling fallback carries the load.
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
