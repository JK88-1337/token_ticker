import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseTranscriptLine, type UsageRecord } from '../core/records.js';

/** Where Claude Code keeps transcripts for the current user. */
export function defaultTranscriptRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

/** Claude Code names every transcript with this suffix. */
const TRANSCRIPT_SUFFIX = '.jsonl';

/**
 * Every transcript under a Claude Code projects root.
 *
 * The layout is one directory per project, each holding one file per session.
 * A missing root is not an error — it just means Claude Code has not run for
 * this user yet.
 */
export async function findTranscripts(root: string): Promise<string[]> {
  let projects: string[];
  try {
    projects = await readdir(root);
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const project of projects) {
    const dir = join(root, project);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // A file rather than a project directory.
    }
    for (const entry of entries) {
      if (entry.endsWith(TRANSCRIPT_SUFFIX)) found.push(join(dir, entry));
    }
  }

  return found;
}

/** What one incremental read yielded, and where to resume next time. */
export interface TranscriptRead {
  records: UsageRecord[];
  offset: number;
}

/**
 * Reads the records a transcript has gained since `offset`.
 *
 * Transcripts are append-only and are written while we read them, so two
 * things have to hold. A half-written trailing line is left unconsumed until
 * its newline arrives — advancing past it would lose that record for good.
 * And a file shorter than the cursor has been rewritten rather than appended
 * to, so the cursor is meaningless and the read starts over.
 */
export async function readTranscriptFrom(path: string, offset: number): Promise<TranscriptRead> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return { records: [], offset: 0 }; // Deleted between listing and reading.
  }

  const from = size < offset ? 0 : offset;
  if (size === from) return { records: [], offset: from };

  const handle = await open(path, 'r');
  let chunk: Buffer;
  try {
    chunk = Buffer.allocUnsafe(size - from);
    await handle.read(chunk, 0, chunk.length, from);
  } finally {
    await handle.close();
  }

  const text = chunk.toString('utf8');
  const lastBreak = text.lastIndexOf('\n');
  if (lastBreak === -1) return { records: [], offset: from };

  const complete = text.slice(0, lastBreak);
  const records: UsageRecord[] = [];
  for (const line of complete.split('\n')) {
    if (!line.trim()) continue;
    const record = parseTranscriptLine(line);
    if (record) records.push(record);
  }

  return { records, offset: from + Buffer.byteLength(complete) + 1 };
}

/** How far each transcript has been read, keyed by path. */
export type ScanCursors = Record<string, number>;

export interface TranscriptScan {
  /** Only the records written since the cursors were taken. */
  records: UsageRecord[];
  /** Cursors to hand back on the next scan. */
  cursors: ScanCursors;
}

/**
 * Reads whatever the transcript tree has gained since the given cursors.
 *
 * Passing no cursors reads everything. Cursors for transcripts that have since
 * disappeared are dropped rather than carried forward, so the map cannot grow
 * without bound as sessions come and go.
 *
 * Records are returned as found, duplicates included: the same API call really
 * does appear in several transcripts once a session is resumed, and only a
 * caller holding the whole history can tell a repeat from a new turn. Fold the
 * result through `dedupeRecords` before totalling.
 */
export async function scanTranscripts(root: string, cursors: ScanCursors = {}): Promise<TranscriptScan> {
  const paths = await findTranscripts(root);

  const reads = await Promise.all(
    paths.map(async (path) => ({ path, read: await readTranscriptFrom(path, cursors[path] ?? 0) })),
  );

  const records: UsageRecord[] = [];
  const next: ScanCursors = {};
  for (const { path, read } of reads) {
    records.push(...read.records);
    next[path] = read.offset;
  }

  return { records, cursors: next };
}
