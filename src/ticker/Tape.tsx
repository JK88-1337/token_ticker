import type { ReactNode } from 'react';

/**
 * The crawl along the bottom of the board.
 *
 * The row is rendered twice and the pair is translated by exactly half its
 * width, so the second copy is standing where the first one started when the
 * loop restarts and the crawl has no seam. Hovering stops it, because a
 * figure you have to chase is a figure you cannot read.
 */
export function Tape({ items, seconds = 60 }: { items: ReactNode[]; seconds?: number }) {
  if (items.length === 0) return <div className="tape" />;

  const run = (copy: string) => (
    <div className="tape-run" key={copy} aria-hidden={copy === 'b'}>
      {items.map((item, index) => (
        <span className="tape-item" key={`${copy}-${index}`}>
          {item}
        </span>
      ))}
    </div>
  );

  return (
    <div className="tape">
      <div className="tape-belt" style={{ animationDuration: `${seconds}s` }}>
        {run('a')}
        {run('b')}
      </div>
    </div>
  );
}
