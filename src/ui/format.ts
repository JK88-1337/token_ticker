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
