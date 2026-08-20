import type { UsageRecord } from './records.js';

/**
 * Drops repeat sightings of the same API call.
 *
 * Claude Code copies earlier turns into a fresh transcript whenever a session
 * is resumed or branched, so one call can be recorded many times. Summing the
 * raw lines therefore overstates usage; the first sighting wins.
 */
export function dedupeRecords(records: Iterable<UsageRecord>): UsageRecord[] {
  const seen = new Set<string>();
  const unique: UsageRecord[] = [];

  for (const record of records) {
    if (seen.has(record.requestId)) continue;
    seen.add(record.requestId);
    unique.push(record);
  }

  return unique;
}
