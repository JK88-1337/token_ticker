import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { UsageSnapshot } from '../src/core/snapshot.js';

/**
 * The only thing the renderer is given.
 *
 * Node stays out of the page: no filesystem, no process, no ipcRenderer
 * itself — just a subscription that yields the same `UsageSnapshot` the dev
 * server sends over SSE.
 */
contextBridge.exposeInMainWorld('tokenTicker', {
  subscribe(
    timeZone: string,
    onSnapshot: (snapshot: UsageSnapshot) => void,
    onActivity: () => void,
  ): () => void {
    const snapshot = (_event: IpcRendererEvent, payload: UsageSnapshot) => onSnapshot(payload);
    const activity = () => onActivity();

    ipcRenderer.on('usage:snapshot', snapshot);
    ipcRenderer.on('usage:activity', activity);
    ipcRenderer.send('usage:subscribe', timeZone);

    return () => {
      ipcRenderer.off('usage:snapshot', snapshot);
      ipcRenderer.off('usage:activity', activity);
    };
  },
});
