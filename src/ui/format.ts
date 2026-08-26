/** Money, at the precision the size warrants. */
export function usd(value: number): string {
  if (value >= 1000) return `$${Math.round(value).toLocaleString('en-US')}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value === 0) return '$0';
  return `$${value.toFixed(3)}`;
}

/** Token counts run to the hundreds of millions, so abbreviate. */
export function compact(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString('en-US');
}

export function count(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Every digit, grouped.
 *
 * The headline figures are shown in full rather than abbreviated: `1,247,882`
 * has seven digits that move, `1.2M` has two. Watching them move is the point.
 */
export function full(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** `2026-08-20` in the viewer's zone — the key `byDay` is bucketed under. */
export function todayKey(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * The day key `daysAgo` before today, in the viewer's zone.
 *
 * Day keys sort lexicographically, so a cutoff key is all a "last N days"
 * filter needs — no date arithmetic on the buckets themselves.
 */
export function dayKeyBefore(timeZone: string, daysAgo: number): string {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** `Aug 20` — an axis tick, not a full date. */
export function shortDay(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** The last path segment, which is what identifies a project to its owner. */
export function projectName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The local hour a turn belongs to, as `YYYY-MM-DD HH`.
 *
 * Sortable as a string, and bucketed in the viewer's zone for the same reason
 * days are — "this afternoon" is a question about the local clock.
 */
export function hourKey(timestamp: string, timeZone: string): string {
  let formatter = hourFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      // h23 rather than `hour12: false`, which is allowed to render midnight
      // as 24 — an hour that would sort after 23 while belonging before it.
      hourCycle: 'h23',
    });
    hourFormatters.set(timeZone, formatter);
  }

  // en-CA renders `2026-08-25, 20`; the comma is the only thing in the way.
  return formatter.format(new Date(timestamp)).replace(', ', ' ');
}

const minuteFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The local minute a turn belongs to, as `YYYY-MM-DD HH:MM`.
 *
 * The finest bucket the ticker draws: at a minute a candle is close enough to
 * live that a run of turns shows up as it happens, and still coarse enough
 * that one turn does not become one candle.
 */
export function minuteKey(timestamp: string, timeZone: string): string {
  let formatter = minuteFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      // h23 for the same reason the hour key uses it: midnight must sort as
      // 00 at the head of its day, not as 24 at the tail of the one before.
      hourCycle: 'h23',
    });
    minuteFormatters.set(timeZone, formatter);
  }

  return formatter.format(new Date(timestamp)).replace(', ', ' ');
}

/** `18:07` — an axis tick for a minute key. */
export function shortMinute(key: string): string {
  return key.slice(-5);
}

/** `20:00` — an axis tick for an hour key. */
export function shortHour(key: string): string {
  return `${key.slice(-2)}:00`;
}
