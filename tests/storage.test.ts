import { describe, expect, it } from 'vitest';
import { newFarm } from '../src/farm/state.js';
import {
  BROKEN_KEY,
  SAVE_KEY,
  exportSave,
  importSave,
  readSave,
  writeSave,
  type SaveStore,
} from '../src/farm/storage.js';

/** A store that behaves like localStorage, without needing one. */
function fakeStore(seed: Record<string, string> = {}): SaveStore & { all: Map<string, string> } {
  const all = new Map(Object.entries(seed));
  return {
    all,
    get: (key) => all.get(key) ?? null,
    set: (key, value) => {
      all.set(key, value);
    },
    remove: (key) => {
      all.delete(key);
    },
  };
}

const farm = () => ({ ...newFarm(() => 0.42), coins: 640, harvested: ['wheat'] });

describe('keeping a save', () => {
  it('reads back what was written', () => {
    const store = fakeStore();
    writeSave(store, farm());

    expect(readSave(store)).toMatchObject({ coins: 640, harvested: ['wheat'] });
  });

  it('keeps the save it is replacing, so one bad write is not the end of it', () => {
    const store = fakeStore();
    writeSave(store, farm());
    writeSave(store, { ...farm(), coins: 700 });

    // The primary moved on; the one before it is still there.
    expect(readSave(store).coins).toBe(700);
    expect(JSON.parse(store.get('token-ticker.farm.backup')!).coins).toBe(640);
  });

  it('falls back to the backup when the save itself is unreadable', () => {
    const store = fakeStore();
    writeSave(store, farm());
    writeSave(store, { ...farm(), coins: 700 });
    store.set(SAVE_KEY, '{ this is not json');

    expect(readSave(store).coins).toBe(640);
  });

  it('parks an unreadable save instead of writing over it', () => {
    const store = fakeStore({ [SAVE_KEY]: '{ this is not json' });

    readSave(store);

    expect(store.get(BROKEN_KEY)).toBe('{ this is not json');
    // And the ruined bytes are gone from the slot the game writes to, so the
    // next write cannot be mistaken for a recovery of them.
    expect(store.get(SAVE_KEY)).toBeNull();
  });

  it('starts a new farm when there is nothing anywhere, without losing anything', () => {
    const store = fakeStore();

    expect(readSave(store).coins).toBe(0);
    expect(store.get(BROKEN_KEY)).toBeNull();
  });

  it('keeps playing when the store refuses to write', () => {
    const store: SaveStore = {
      get: () => null,
      set: () => {
        throw new Error('quota exceeded');
      },
      remove: () => {},
    };

    expect(() => writeSave(store, farm())).not.toThrow();
  });
});

describe('taking a save somewhere else', () => {
  it('writes out a save that reads back as the same farm', () => {
    const mine = { ...farm(), coins: 1_234, trinkets: ['pond'] };

    expect(importSave(exportSave(mine))).toMatchObject({
      coins: 1_234,
      trinkets: ['pond'],
      spinSeed: mine.spinSeed,
    });
  });

  it('refuses anything that is not a save, rather than starting an empty one', () => {
    expect(importSave('')).toBeNull();
    expect(importSave('hello')).toBeNull();
    expect(importSave('{"coins":99999}')).toBeNull();
    expect(importSave('[1,2,3]')).toBeNull();
  });

  it('takes a save exported by the older build, and brings it up to date', () => {
    const legacy = JSON.stringify({
      version: 1,
      spinSeed: 'old-save',
      coins: 300,
      spinsUsed: 1,
      plots: [{ seedId: 'corn', plantedAtWork: 5_000 }],
      trinkets: [],
      harvested: ['wheat'],
      lastSpin: null,
    });

    expect(importSave(legacy)).toMatchObject({ version: 2, coins: 300, harvested: ['wheat'] });
  });

  it('ignores the whitespace a copy and paste picks up', () => {
    expect(importSave(`
  ${exportSave(farm())}  
`)).toMatchObject({ coins: 640 });
  });
});
