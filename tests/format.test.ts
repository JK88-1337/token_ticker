import { describe, expect, it } from 'vitest';
import { minuteKey, shortMinute } from '../src/ui/format.js';

describe('minuteKey', () => {
  it('buckets a turn by the minute it happened in, in the viewer’s own zone', () => {
    const at = '2026-08-25T18:07:42Z';

    expect(minuteKey(at, 'UTC')).toBe('2026-08-25 18:07');
    expect(minuteKey(at, 'Asia/Shanghai')).toBe('2026-08-26 02:07');
  });

  it('sorts as a string in the order the minutes happened', () => {
    const keys = [
      minuteKey('2026-08-25T18:09:00Z', 'UTC'),
      minuteKey('2026-08-25T09:00:00Z', 'UTC'),
      minuteKey('2026-08-25T18:10:00Z', 'UTC'),
    ];

    expect([...keys].sort()).toEqual([
      '2026-08-25 09:00',
      '2026-08-25 18:09',
      '2026-08-25 18:10',
    ]);
  });

  it('keeps midnight at the start of its day rather than the end of the one before', () => {
    expect(minuteKey('2026-08-25T00:00:30Z', 'UTC')).toBe('2026-08-25 00:00');
  });

  it('labels an axis tick with the clock time alone', () => {
    expect(shortMinute('2026-08-25 18:07')).toBe('18:07');
  });
});
