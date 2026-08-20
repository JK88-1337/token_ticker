import { describe, expect, it } from 'vitest';
import { parseTranscriptLine } from '../src/core/records.js';
import { dedupeRecords } from '../src/core/ledger.js';
import { assistantLine } from './fixtures.js';

function records(...lines: string[]) {
  return lines.map((line) => parseTranscriptLine(line)!);
}

describe('dedupeRecords', () => {
  it('counts an API call once even when several transcripts recorded it', () => {
    // Resuming or branching a session copies earlier turns into a new
    // transcript file, so the same call legitimately appears more than once.
    const deduped = dedupeRecords(
      records(
        assistantLine({ requestId: 'req_a', output: 100 }),
        assistantLine({ requestId: 'req_a', output: 100 }),
        assistantLine({ requestId: 'req_a', output: 100 }),
      ),
    );

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.tokens.output).toBe(100);
  });

  it('keeps distinct API calls', () => {
    const deduped = dedupeRecords(
      records(
        assistantLine({ requestId: 'req_a', output: 100 }),
        assistantLine({ requestId: 'req_b', output: 200 }),
      ),
    );

    expect(deduped.map((r) => r.requestId)).toEqual(['req_a', 'req_b']);
  });
});
