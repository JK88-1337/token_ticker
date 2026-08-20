/**
 * Development tool — not part of the shipped app.
 *
 * Runs the core parser over your own `~/.claude/projects` tree and prints what
 * it found, so the numbers can be eyeballed against reality. File discovery is
 * inlined here on purpose: the tested IO layer does not exist yet, and this
 * script must not be mistaken for it.
 *
 *   npm run scan
 *   npm run scan -- --by-project
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dedupeRecords } from '../src/core/ledger.js';
import { parseTranscriptLine, type TokenCounts, type UsageRecord } from '../src/core/records.js';

function transcriptFiles(root: string): string[] {
  const files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    console.error(`No transcripts at ${root} — is Claude Code installed for this user?`);
    process.exit(1);
  }
  for (const entry of entries) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.jsonl')) files.push(join(dir, file));
    }
  }
  return files;
}

function total(records: readonly UsageRecord[]): TokenCounts {
  return records.reduce<TokenCounts>(
    (acc, r) => ({
      input: acc.input + r.tokens.input,
      output: acc.output + r.tokens.output,
      cacheRead: acc.cacheRead + r.tokens.cacheRead,
      cacheWrite5m: acc.cacheWrite5m + r.tokens.cacheWrite5m,
      cacheWrite1h: acc.cacheWrite1h + r.tokens.cacheWrite1h,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  );
}

const n = (value: number) => value.toLocaleString('en-US');

function printTotals(label: string, counts: TokenCounts): void {
  console.log(
    `${label.padEnd(9)} in=${n(counts.input)}  out=${n(counts.output)}  ` +
      `cache-read=${n(counts.cacheRead)}  cache-write=${n(counts.cacheWrite5m + counts.cacheWrite1h)}`,
  );
}

const root = join(homedir(), '.claude', 'projects');
const files = transcriptFiles(root);

const parsed: UsageRecord[] = [];
let lines = 0;
for (const file of files) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    lines++;
    const record = parseTranscriptLine(line);
    if (record) parsed.push(record);
  }
}
const records = dedupeRecords(parsed);

console.log(`\nroot      ${root}`);
console.log(`files     ${n(files.length)}`);
console.log(`lines     ${n(lines)} read, ${n(parsed.length)} billable, ${n(records.length)} after dedupe`);
console.log(`duplicates ${n(parsed.length - records.length)} repeat sightings dropped\n`);

printTotals('raw', total(parsed));
printTotals('deduped', total(records));

const byModel = new Map<string, UsageRecord[]>();
for (const record of records) {
  const bucket = byModel.get(record.model) ?? [];
  bucket.push(record);
  byModel.set(record.model, bucket);
}
console.log('\nby model');
for (const [model, bucket] of [...byModel].sort((a, b) => b[1].length - a[1].length)) {
  printTotals(`  ${model}`, total(bucket));
}

if (process.argv.includes('--by-project')) {
  const byProject = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const bucket = byProject.get(record.projectPath) ?? [];
    bucket.push(record);
    byProject.set(record.projectPath, bucket);
  }
  console.log('\nby project');
  for (const [project, bucket] of [...byProject].sort((a, b) => b[1].length - a[1].length)) {
    printTotals(`  ${project}`, total(bucket));
  }
}

console.log();
