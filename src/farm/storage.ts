import { useCallback, useEffect, useState } from 'react';
import { newFarm, sanitise, type FarmState } from './state.js';

/**
 * Where the farm lives between sessions.
 *
 * Local storage rather than a file over IPC: the packaged app keeps its own
 * user-data partition, so the same call persists in the desktop build and in
 * a browser tab without the main process having to know the game exists. The
 * measuring side of this app writes nothing at all, and that stays true —
 * this is the only thing on disk, and it is a toy.
 *
 * Losing it is still not acceptable, so three rules hold, and they are the
 * reason this is more than two calls to `localStorage`:
 *
 *   1. **A save that cannot be read is never written over.** It is moved to
 *      a slot of its own first. A bad write or a migration that goes wrong
 *      leaves something to recover from rather than a silently empty field.
 *   2. **The previous save is kept.** One write can go wrong; two in a row
 *      going wrong is a different kind of problem.
 *   3. **A store that refuses to write does not stop the game.** Storage can
 *      be full, disabled, or a private window; the farm still plays for the
 *      session.
 *
 * Every path is guarded, because none of this is allowed to stop the ticker
 * opening.
 */

/** The save the game reads and writes. */
export const SAVE_KEY = 'token-ticker.farm.v1';
/** The save it is replacing, kept one deep. */
export const BACKUP_KEY = 'token-ticker.farm.backup';
/** Bytes that could not be read, parked rather than destroyed. */
export const BROKEN_KEY = 'token-ticker.farm.broken';

/** The slice of `localStorage` this needs, so the rules above can be tested. */
export interface SaveStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Whether a stored string is a farm this build can actually load. */
function readable(raw: string | null): FarmState | null {
  if (raw === null) return null;
  try {
    const loaded: unknown = JSON.parse(raw);
    if (typeof loaded !== 'object' || loaded === null) return null;
    // A save from a build that never existed is not a save. Everything else
    // sanitise clamps into range rather than rejecting.
    const version = (loaded as { version?: unknown }).version;
    if (version !== 1 && version !== 2) return null;
    return sanitise(loaded);
  } catch {
    return null;
  }
}

/**
 * The farm as it was left, or the nearest thing to it that survives.
 *
 * Tries the save, then the save before it, and only then starts fresh — and
 * whatever it could not read is parked under {@link BROKEN_KEY} on the way
 * past, so a fresh start is never a deletion.
 */
export function readSave(store: SaveStore, random: () => number = Math.random): FarmState {
  const raw = store.get(SAVE_KEY);
  const saved = readable(raw);
  if (saved) return saved;

  if (raw !== null) {
    store.set(BROKEN_KEY, raw);
    // Cleared so the next write cannot look like it recovered these bytes.
    store.remove(SAVE_KEY);
  }

  return readable(store.get(BACKUP_KEY)) ?? newFarm(random);
}

/** Writes the farm, keeping the save it replaces. */
export function writeSave(store: SaveStore, state: FarmState): void {
  try {
    const previous = store.get(SAVE_KEY);
    if (previous) store.set(BACKUP_KEY, previous);
    store.set(SAVE_KEY, JSON.stringify(state));
  } catch {
    // A farm that cannot be written is still a farm for this session.
  }
}

/**
 * The save as text, to keep somewhere this app cannot reach.
 *
 * The one recovery that survives a cleared browser, a renamed app directory
 * or a new machine — none of which the game can do anything about from the
 * inside.
 */
export function exportSave(state: FarmState): string {
  return JSON.stringify(state);
}

/**
 * A pasted save, or null if that is not what it is.
 *
 * Null rather than a fresh farm on purpose: importing rubbish must not be a
 * way to wipe the field, so the caller is left to say so and change nothing.
 */
export function importSave(text: string): FarmState | null {
  return readable(text.trim());
}

/** `localStorage`, if this page has one at all. */
function browserStore(): SaveStore | null {
  try {
    const storage = window.localStorage;
    return {
      get: (key) => storage.getItem(key),
      set: (key, value) => storage.setItem(key, value),
      remove: (key) => storage.removeItem(key),
    };
  } catch {
    return null;
  }
}

export function loadFarm(): FarmState {
  const store = browserStore();
  return store ? readSave(store) : newFarm();
}

export function saveFarm(state: FarmState): void {
  const store = browserStore();
  if (store) writeSave(store, state);
}

/**
 * The save, and a way to move it on.
 *
 * Moves are applied through the pure functions in `state.ts` — the caller
 * passes one in — so the rules live in one place and the hook only decides
 * when to write.
 */
export function useFarm(): [FarmState, (move: (state: FarmState) => FarmState) => void] {
  const [state, setState] = useState<FarmState>(loadFarm);

  useEffect(() => {
    saveFarm(state);
  }, [state]);

  const apply = useCallback((move: (state: FarmState) => FarmState) => {
    setState((current) => move(current));
  }, []);

  return [state, apply];
}
