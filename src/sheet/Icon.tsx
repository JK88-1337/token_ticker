import type { ReactNode } from 'react';
import type { AchievementIcon } from './character.js';

/**
 * The achievement marks, as line art.
 *
 * Drawn rather than set in emoji: emoji render differently on every platform,
 * carry their own colour, and read as decoration next to a figure. These
 * inherit `currentColor`, so a locked badge greys out with its own text.
 */
const PATHS: Record<AchievementIcon, ReactNode> = {
  shield: (
    <>
      <path d="M12 2.5 20 5.5v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11v-6z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </>
  ),
  flame: (
    <path d="M12 2.5c3.2 4 6.2 6.2 6.2 10.2A6.2 6.2 0 0 1 12 19a6.2 6.2 0 0 1-6.2-6.3c0-2 1-3.3 2.2-4.3 0 2 1 3.1 2 3.1 0-3.2 1-6.2 2-9z" />
  ),
  bolt: <path d="M13.5 2.5 4.5 14h6l-1.2 7.5L19.5 10h-6.2z" />,
  layers: (
    <>
      <path d="M12 3 21 8l-9 5-9-5z" />
      <path d="M3 12.5 12 17.5l9-5" />
      <path d="M3 17 12 22l9-5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  spark: <path d="M12 2.5v19M2.5 12h19M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />,
};

export function Icon({ name, className }: { name: AchievementIcon; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
