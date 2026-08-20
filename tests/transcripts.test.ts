import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findTranscripts, readTranscriptFrom, scanTranscripts } from '../src/node/transcripts.js';
import { assistantLine } from './fixtures.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'token-ticker-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes `name` inside a project directory, mirroring the real layout. */
function transcript(project: string, name: string, body = ''): string {
  const dir = join(root, project);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

describe('findTranscripts', () => {
  it('finds the jsonl files across project directories', async () => {
    const a = transcript('project-a', 'session-1.jsonl');
    const b = transcript('project-a', 'session-2.jsonl');
    const c = transcript('project-b', 'session-3.jsonl');

    const found = await findTranscripts(root);

    expect(found.sort()).toEqual([a, b, c].sort());
  });

  it('ignores everything that is not a transcript', async () => {
    const real = transcript('project-a', 'session-1.jsonl');
    transcript('project-a', 'notes.md');
    transcript('project-a', 'session-1.jsonl.bak');

    expect(await findTranscripts(root)).toEqual([real]);
  });

  it('returns nothing when the transcript root does not exist', async () => {
    expect(await findTranscripts(join(root, 'nope'))).toEqual([]);
  });
});

describe('readTranscriptFrom', () => {
  it('reads every record in a file and reports where it stopped', async () => {
    const body = assistantLine({ requestId: 'req_a' }) + '\n' + assistantLine({ requestId: 'req_b' }) + '\n';
    const path = transcript('project-a', 'session-1.jsonl', body);

    const read = await readTranscriptFrom(path, 0);

    expect(read.records.map((r) => r.requestId)).toEqual(['req_a', 'req_b']);
    expect(read.offset).toBe(Buffer.byteLength(body));
  });

  it('reads nothing more when the file has not grown', async () => {
    const path = transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    const first = await readTranscriptFrom(path, 0);

    const second = await readTranscriptFrom(path, first.offset);

    expect(second.records).toEqual([]);
    expect(second.offset).toBe(first.offset);
  });

  it('reads only what was appended since the last read', async () => {
    const path = transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    const first = await readTranscriptFrom(path, 0);

    appendFileSync(path, assistantLine({ requestId: 'req_b' }) + '\n');
    const second = await readTranscriptFrom(path, first.offset);

    expect(second.records.map((r) => r.requestId)).toEqual(['req_b']);
  });

  it('leaves a half-written line alone until its newline arrives', async () => {
    // Claude Code appends while we read, so the tail can be a torn line.
    // Consuming it would drop the record for good once the rest lands.
    const complete = assistantLine({ requestId: 'req_a' }) + '\n';
    const torn = assistantLine({ requestId: 'req_b' });
    const half = torn.slice(0, 40);
    const path = transcript('project-a', 'session-1.jsonl', complete + half);

    const first = await readTranscriptFrom(path, 0);
    expect(first.records.map((r) => r.requestId)).toEqual(['req_a']);
    expect(first.offset).toBe(Buffer.byteLength(complete));

    appendFileSync(path, torn.slice(40) + '\n');
    const second = await readTranscriptFrom(path, first.offset);
    expect(second.records.map((r) => r.requestId)).toEqual(['req_b']);
  });

  it('starts over when the file is shorter than where we left off', async () => {
    // A rewritten or rotated transcript invalidates the cursor; carrying on
    // from it would read from the middle of a line.
    const path = transcript(
      'project-a',
      'session-1.jsonl',
      assistantLine({ requestId: 'req_a' }) + '\n' + assistantLine({ requestId: 'req_b' }) + '\n',
    );
    const first = await readTranscriptFrom(path, 0);

    writeFileSync(path, assistantLine({ requestId: 'req_c' }) + '\n');
    const second = await readTranscriptFrom(path, first.offset);

    expect(second.records.map((r) => r.requestId)).toEqual(['req_c']);
  });

  it('reports a vanished file as empty rather than failing', async () => {
    const read = await readTranscriptFrom(join(root, 'gone.jsonl'), 0);

    expect(read.records).toEqual([]);
    expect(read.offset).toBe(0);
  });
});

describe('scanTranscripts', () => {
  it('reads every transcript on a first scan', async () => {
    transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    transcript('project-b', 'session-2.jsonl', assistantLine({ requestId: 'req_b' }) + '\n');

    const scan = await scanTranscripts(root);

    expect(scan.records.map((r) => r.requestId).sort()).toEqual(['req_a', 'req_b']);
    expect(Object.keys(scan.cursors)).toHaveLength(2);
  });

  it('reads nothing on a rescan when nothing was written', async () => {
    transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    const first = await scanTranscripts(root);

    const second = await scanTranscripts(root, first.cursors);

    expect(second.records).toEqual([]);
  });

  it('reads only the turns appended since the last scan', async () => {
    const path = transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    const first = await scanTranscripts(root);

    appendFileSync(path, assistantLine({ requestId: 'req_b' }) + '\n');
    const second = await scanTranscripts(root, first.cursors);

    expect(second.records.map((r) => r.requestId)).toEqual(['req_b']);
  });

  it('picks up a session that started after the last scan', async () => {
    transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    const first = await scanTranscripts(root);

    transcript('project-a', 'session-2.jsonl', assistantLine({ requestId: 'req_b' }) + '\n');
    const second = await scanTranscripts(root, first.cursors);

    expect(second.records.map((r) => r.requestId)).toEqual(['req_b']);
  });

  it('drops cursors for transcripts that are gone', async () => {
    const path = transcript('project-a', 'session-1.jsonl', assistantLine({ requestId: 'req_a' }) + '\n');
    const first = await scanTranscripts(root);

    rmSync(path);
    const second = await scanTranscripts(root, first.cursors);

    expect(second.cursors).toEqual({});
  });
});
