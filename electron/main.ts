import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { defaultPricingTable } from '../src/core/pricing.js';
import { watchTree } from '../src/node/feed.js';
import { UsageStore } from '../src/node/store.js';
import { defaultTranscriptRoot } from '../src/node/transcripts.js';

/** Bursts of appends settle into one rebuild. */
const SETTLE_MS = 120;
/** A backstop in case the watcher misses something. */
const SWEEP_MS = 5_000;

const root = defaultTranscriptRoot();
const store = new UsageStore(root);

/** The zone each window asked for; the browser knows it, the process does not. */
const zones = new Map<number, string>();

let refreshing: Promise<boolean> | null = null;

/** Refreshes once even if several triggers land together. */
function refresh(): Promise<boolean> {
  refreshing ??= store.refresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function sendSnapshot(window: BrowserWindow): void {
  const timeZone = zones.get(window.id);
  if (!timeZone || window.isDestroyed()) return;
  window.webContents.send('usage:snapshot', store.snapshot(defaultPricingTable, timeZone));
}

async function broadcast(): Promise<void> {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) return;

  const changed = await refresh();
  for (const window of windows) {
    if (window.isDestroyed()) continue;
    if (changed) sendSnapshot(window);
    // A write that carried nothing billable is a turn being generated, a tool
    // result landing. Worth saying so; it is not a token count.
    else window.webContents.send('usage:activity');
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#0d0d0d',
    show: false,
    title: 'token_ticker',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      // The page renders local data and needs nothing from Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => zones.delete(window.id));

  // Nothing in the page should be able to open a window or navigate away; any
  // link the user means to follow goes to their browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  const devServer = process.env['VITE_DEV_SERVER_URL'];
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(join(__dirname, '../dist/index.html'));
}

// One instance, so two copies cannot watch the same tree and fight over it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  ipcMain.on('usage:subscribe', (event, timeZone: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    zones.set(window.id, typeof timeZone === 'string' && timeZone ? timeZone : 'UTC');
    void refresh().then(() => sendSnapshot(window));
  });

  void app.whenReady().then(() => {
    createWindow();

    const stopWatching = watchTree(root, SETTLE_MS, () => void broadcast());
    const sweep = setInterval(() => void broadcast(), SWEEP_MS);

    app.on('will-quit', () => {
      stopWatching();
      clearInterval(sweep);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
