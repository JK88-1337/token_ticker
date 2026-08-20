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
import { defaultPricingTable, priceRecord } from '../src/core/pricing.js';
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

function usdTotal(records: readonly UsageRecord[]): number {
  return records.reduce((acc, r) => acc + priceRecord(r, defaultPricingTable).usd, 0);
}

const n = (value: number) => value.toLocaleString('en-US');
const usd = (value: number) => `$${value.toFixed(2)}`;

function printTotals(label: string, records: readonly UsageRecord[]): void {
  const counts = total(records);
  console.log(
    `${label.padEnd(18)} ${usd(usdTotal(records)).padStart(10)}   ` +
      `in=${n(counts.input)}  out=${n(counts.output)}  ` +
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

printTotals('raw', parsed);
printTotals('deduped', records);

const unpriced = records.filter((r) => !priceRecord(r, defaultPricingTable).priced);
if (unpriced.length > 0) {
  const models = [...new Set(unpriced.map((r) => r.model))].join(', ');
  console.log(`\n!! ${n(unpriced.length)} turns have no rate and count as $0 — add: ${models}`);
}

const byModel = new Map<string, UsageRecord[]>();
for (const record of records) {
  const bucket = byModel.get(record.model) ?? [];
  bucket.push(record);
  byModel.set(record.model, bucket);
}
console.log('\nby model');
for (const [model, bucket] of [...byModel].sort((a, b) => usdTotal(b[1]) - usdTotal(a[1]))) {
  printTotals(`  ${model}`, bucket);
}

if (process.argv.includes('--by-project')) {
  const byProject = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const bucket = byProject.get(record.projectPath) ?? [];
    bucket.push(record);
    byProject.set(record.projectPath, bucket);
  }
  console.log('\nby project');
  for (const [project, bucket] of [...byProject].sort((a, b) => usdTotal(b[1]) - usdTotal(a[1]))) {
    printTotals(`  ${project}`, bucket);
  }
}

console.log();
