/**
 * Development tool — not part of the shipped app.
 *
 * Runs the core over your own `~/.claude/projects` tree and prints what it
 * found, so the numbers can be eyeballed against reality. File discovery is
 * inlined here on purpose: the tested IO layer does not exist yet, and this
 * script must not be mistaken for it.
 *
 *   npm run scan
 *   npm run scan -- --by-project
 *   npm run scan -- --days 30
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dedupeRecords } from '../src/core/ledger.js';
import { defaultPricingTable as table } from '../src/core/pricing.js';
import { parseTranscriptLine, type UsageRecord } from '../src/core/records.js';
import { bucketBy, bucketByDay, totalUsage, type UsageBucket, type UsageTotals } from '../src/core/summary.js';

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

function flagValue(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const parsed = Number(process.argv[at + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const n = (value: number) => value.toLocaleString('en-US');
const usd = (value: number) => `$${value.toFixed(2)}`;

function printTotals(label: string, totals: UsageTotals): void {
  const { tokens } = totals;
  const flag = totals.unpricedTurns > 0 ? ` (${totals.unpricedTurns} unpriced)` : '';
  console.log(
    `${label.padEnd(24)} ${usd(totals.usd).padStart(10)}   ` +
      `turns=${n(totals.turns)}  out=${n(tokens.output)}  ` +
      `cache-read=${n(tokens.cacheRead)}  cache-write=${n(tokens.cacheWrite5m + tokens.cacheWrite1h)}${flag}`,
  );
}

function printBuckets(heading: string, buckets: UsageBucket[]): void {
  console.log(`\n${heading}`);
  for (const bucket of buckets) printTotals(`  ${bucket.key}`, bucket.totals);
}

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const days = flagValue('days', 14);
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
console.log(`zone      ${timeZone}`);
console.log(`files     ${n(files.length)}`);
console.log(`lines     ${n(lines)} read, ${n(parsed.length)} billable, ${n(records.length)} after dedupe`);
console.log(`duplicates ${n(parsed.length - records.length)} repeat sightings dropped\n`);

printTotals('raw', totalUsage(parsed, table));
printTotals('deduped', totalUsage(records, table));

const byCost = (a: UsageBucket, b: UsageBucket) => b.totals.usd - a.totals.usd;

printBuckets('by model', bucketBy(records, table, (r) => r.model).sort(byCost));
// Days with no usage produce no bucket, so this is the last N *active* days.
// Filling the gaps is a presentation decision, left to whatever draws the chart.
printBuckets(`last ${days} active days`, bucketByDay(records, table, timeZone).slice(-days));

if (process.argv.includes('--by-project')) {
  printBuckets('by project', bucketBy(records, table, (r) => r.projectPath).sort(byCost));
}

console.log();
