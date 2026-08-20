import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageStore } from '../src/node/store.js';
import { apiErrorLine, assistantLine, testPricingTable as table } from './fixtures.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'token-ticker-store-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function transcript(project: string, name: string, body = ''): string {
  const dir = join(root, project);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

describe('UsageStore', () => {
  it('keeps earlier turns when a later scan brings new ones', async () => {
    const path = transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    const store = new UsageStore(root);
    await store.refresh();

    appendFileSync(path, assistantLine({ requestId: 'req_b' }) + '\n');
    await store.refresh();

    expect(store.snapshot(table, 'UTC').totals.turns).toBe(2);
  });

  it('counts a call once when a resumed session copies it into another transcript', async () => {
    // The reason deduplication cannot live in the scanner: only something
    // holding the whole history can tell a repeat from a new turn.
    transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    const store = new UsageStore(root);
    await store.refresh();

    transcript('project-a', 'session-2.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    await store.refresh();

    expect(store.snapshot(table, 'UTC').totals.turns).toBe(1);
  });

  it('starts out empty', async () => {
    const store = new UsageStore(root);

    expect(store.snapshot(table, 'UTC').totals.turns).toBe(0);
  });
});

describe('UsageStore limits', () => {
  it('remembers a refusal and counts it once across resumed sessions', async () => {
    const hit = apiErrorLine({ timestamp: '2026-07-21T08:47:47.452Z' });
    transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n' + hit + '\n');
    const store = new UsageStore(root);
    await store.refresh();

    transcript('project-a', 'session-2.jsonl', hit + '\n');
    await store.refresh();

    expect(store.snapshot(table, 'UTC').limitHits).toHaveLength(1);
  });

  it('reports whether a refresh brought anything new', async () => {
    transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    const store = new UsageStore(root);

    expect(await store.refresh()).toBe(true);
    expect(await store.refresh()).toBe(false);
  });
});
