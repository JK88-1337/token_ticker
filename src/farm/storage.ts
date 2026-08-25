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
 * Every path is guarded. Storage can be unavailable or full, and a save can
 * be edited by hand; none of that is allowed to stop the ticker opening.
 */
const KEY = 'token-ticker.farm.v1';

export function loadFarm(): FarmState {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? sanitise(JSON.parse(raw)) : newFarm();
  } catch {
    return newFarm();
  }
}

export function saveFarm(state: FarmState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A farm that cannot be written is still a farm for this session.
  }
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
