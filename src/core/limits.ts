import type { TokenCounts, UsageRecord } from './records.js';

/**
 * Usage against the rate limit — measured, never assumed.
 *
 * The quota itself is not in the transcripts and is not cached on disk;
 * Claude Code asks its server for it. What the transcripts *do* record is the
 * moment you were cut off, so the ceiling here is observed rather than
 * declared: your own busiest window, and the windows that actually ended in a
 * 429.
 */

/** A moment the API refused a turn because a limit was reached. */
export interface LimitEvent {
  at: string;
  /** Which allowance ran out, as far as the notice says. */
  scope: 'session' | 'weekly' | 'unknown';
  /** The notice Claude Code showed, including when it resets. */
  notice: string;
}

/**
 * The limit notice on a transcript line, if it is one.
 *
 * Claude Code records a refusal as an assistant line carrying
 * `isApiErrorMessage` and the HTTP status. Only 429s are limits — a 401 is an
 * expired token, not an allowance.
 */
export function parseLimitEvent(line: string): LimitEvent | null {
  let parsed: any;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (parsed?.isApiErrorMessage !== true) return null;
  if (parsed.apiErrorStatus !== 429) return null;

  const content = parsed.message?.content;
  const notice = Array.isArray(content)
    ? content
        .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
        .join(' ')
        .trim()
    : '';

  return {
    at: typeof parsed.timestamp === 'string' ? parsed.timestamp : '',
    scope: /weekly/i.test(notice) ? 'weekly' : /session/i.test(notice) ? 'session' : 'unknown',
    notice,
  };
}

/** Turns and tokens over a stretch of time. */
export interface WindowTotals {
  turns: number;
  tokens: TokenCounts;
}

/** A window and when it ended. */
export interface PeakWindow {
  totals: WindowTotals;
  /** Timestamp of the last turn in the window, or null if there were none. */
  endedAt: string | null;
}

function emptyTotals(): WindowTotals {
  return {
    turns: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0 },
  };
}

function absorb(into: WindowTotals, record: UsageRecord, sign: 1 | -1): void {
  into.turns += sign;
  into.tokens.input += sign * record.tokens.input;
  into.tokens.output += sign * record.tokens.output;
  into.tokens.cacheRead += sign * record.tokens.cacheRead;
  into.tokens.cacheWrite5m += sign * record.tokens.cacheWrite5m;
  into.tokens.cacheWrite1h += sign * record.tokens.cacheWrite1h;
  into.tokens.thinking += sign * record.tokens.thinking;
}

function copy(totals: WindowTotals): WindowTotals {
  return { turns: totals.turns, tokens: { ...totals.tokens } };
}

/** Everything spent in the `windowMs` ending at `now`. */
export function windowTokens(
  records: readonly UsageRecord[],
  now: number,
  windowMs: number,
): WindowTotals {
  const since = now - windowMs;
  const totals = emptyTotals();

  for (const record of records) {
    const at = Date.parse(record.timestamp);
    if (Number.isFinite(at) && at > since && at <= now) absorb(totals, record, 1);
  }

  return totals;
}

/**
 * The busiest window of this length in the whole history.
 *
 * This is the closest thing to a ceiling the transcripts can supply on their
 * own: the most you are known to have pushed through in one window. A window
 * that ended in a 429 is a firmer reading still — see {@link parseLimitEvent}.
 */
export function peakWindowTokens(records: readonly UsageRecord[], windowMs: number): PeakWindow {
  const ordered = [...records]
    .filter((record) => Number.isFinite(Date.parse(record.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  if (ordered.length === 0) return { totals: emptyTotals(), endedAt: null };

  // Every maximal window ends on a turn, so sliding a pair of pointers over
  // the turns visits every candidate once.
  const running = emptyTotals();
  let best = emptyTotals();
  let bestEnd: string | null = null;
  let left = 0;

  for (let right = 0; right < ordered.length; right++) {
    const record = ordered[right]!;
    absorb(running, record, 1);

    const endsAt = Date.parse(record.timestamp);
    while (Date.parse(ordered[left]!.timestamp) <= endsAt - windowMs) {
      absorb(running, ordered[left]!, -1);
      left++;
    }

    if (totalTokens(running.tokens) > totalTokens(best.tokens)) {
      best = copy(running);
      bestEnd = record.timestamp;
    }
  }

  return { totals: best, endedAt: bestEnd };
}

/** Every token class added together. */
export function totalTokens(counts: TokenCounts): number {
  return (
    counts.input + counts.output + counts.cacheRead + counts.cacheWrite5m + counts.cacheWrite1h
  );
}

/**
 * Tokens excluding cache reads.
 *
 * Cache reads swamp every other class — hundreds of millions against a few
 * hundred thousand — and they are the cheapest thing the API bills for. For
 * anything meant to track effort or an allowance, they drown the signal.
 */
export function workTokens(counts: TokenCounts): number {
  return counts.input + counts.output + counts.cacheWrite5m + counts.cacheWrite1h;
}
