import { dedupeRecords } from '../core/ledger.js';
import type { PricingTable } from '../core/pricing.js';
import type { UsageRecord } from '../core/records.js';
import { buildSnapshot, type UsageSnapshot } from '../core/snapshot.js';
import { scanTranscripts, type ScanCursors } from './transcripts.js';

/**
 * The accumulated history, refreshed incrementally.
 *
 * Deduplication lives here rather than in the scanner because it needs the
 * whole history: a resumed session copies earlier turns into a new transcript,
 * so a record arriving in a later scan may be one already counted. Only
 * something holding every record seen so far can tell those apart.
 */
export class UsageStore {
  #cursors: ScanCursors = {};
  #records: UsageRecord[] = [];

  constructor(private readonly root: string) {}

  /** Reads whatever has been written since the last refresh. */
  async refresh(): Promise<void> {
    const scan = await scanTranscripts(this.root, this.#cursors);
    this.#cursors = scan.cursors;
    if (scan.records.length > 0) {
      this.#records = dedupeRecords([...this.#records, ...scan.records]);
    }
  }

  /** Everything the dashboard draws, as of the last refresh. */
  snapshot(table: PricingTable, timeZone: string): UsageSnapshot {
    return buildSnapshot(this.#records, table, timeZone);
  }
}
