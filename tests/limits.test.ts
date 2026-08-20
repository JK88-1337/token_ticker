import { describe, expect, it } from 'vitest';
import { parseLimitEvent, peakWindowTokens, windowTokens } from '../src/core/limits.js';
import { apiErrorLine, assistantLine, usageRecord, userLine } from './fixtures.js';

const MINUTE = 60_000;

describe('parseLimitEvent', () => {
  it('recognises the moment a session limit was hit', () => {
    const event = parseLimitEvent(apiErrorLine({ timestamp: '2026-07-21T08:47:47.452Z' }));

    expect(event).toMatchObject({ at: '2026-07-21T08:47:47.452Z', scope: 'session' });
    expect(event?.notice).toContain('resets');
  });

  it('recognises a weekly limit by its wording', () => {
    const event = parseLimitEvent(
      apiErrorLine({ text: "You've hit your weekly limit · resets Monday 9am (UTC)" }),
    );

    expect(event?.scope).toBe('weekly');
  });

  it('ignores failures that are not about limits', () => {
    expect(parseLimitEvent(apiErrorLine({ status: 401, error: 'authentication_failed' }))).toBeNull();
  });

  it('ignores ordinary lines', () => {
    expect(parseLimitEvent(assistantLine())).toBeNull();
    expect(parseLimitEvent(userLine())).toBeNull();
    expect(parseLimitEvent('{ not json')).toBeNull();
  });
});

describe('windowTokens', () => {
  const now = Date.parse('2026-08-21T12:00:00Z');
  const at = (minutesAgo: number) => new Date(now - minutesAgo * MINUTE).toISOString();

  it('adds up only the turns inside the window', () => {
    const total = windowTokens(
      [
        usageRecord({ output: 100 }, { timestamp: at(400) }),
        usageRecord({ output: 30 }, { timestamp: at(100) }),
        usageRecord({ output: 7 }, { timestamp: at(10) }),
      ],
      now,
      300 * MINUTE,
    );

    expect(total.tokens.output).toBe(37);
    expect(total.turns).toBe(2);
  });

  it('is empty when nothing falls inside', () => {
    const total = windowTokens([usageRecord({ output: 100 }, { timestamp: at(999) })], now, 60 * MINUTE);

    expect(total.turns).toBe(0);
    expect(total.tokens.output).toBe(0);
  });
});

describe('peakWindowTokens', () => {
  it('finds the busiest window in the whole history', () => {
    const base = Date.parse('2026-08-01T00:00:00Z');
    const at = (minutes: number) => new Date(base + minutes * MINUTE).toISOString();

    const peak = peakWindowTokens(
      [
        // A quiet pair far apart.
        usageRecord({ output: 10 }, { timestamp: at(0) }),
        usageRecord({ output: 10 }, { timestamp: at(500) }),
        // Three turns packed into one hour — the busiest stretch.
        usageRecord({ output: 40 }, { timestamp: at(1000) }),
        usageRecord({ output: 50 }, { timestamp: at(1020) }),
        usageRecord({ output: 60 }, { timestamp: at(1050) }),
      ],
      60 * MINUTE,
    );

    expect(peak.totals.tokens.output).toBe(150);
    expect(peak.endedAt).toBe(at(1050));
  });

  it('has nothing to report without records', () => {
    expect(peakWindowTokens([], 60 * MINUTE).totals.turns).toBe(0);
  });
});
