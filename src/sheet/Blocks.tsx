/**
 * Blocks — the character sheet as stacked plastic.
 *
 * Three-pixel black rules, offset solid shadows, and four flat colours. The
 * layout is deliberately asymmetric: the number sits in the yellow block at
 * two-thirds width, everything else is a smaller block orbiting it, so the
 * eye has nowhere to go first except the figure that moves.
 */

import type { UsageSnapshot } from '../core/snapshot.js';
import { Odometer } from '../ui/Odometer.js';
import { compact, count, full, usd } from '../ui/format.js';
import { Icon } from './Icon.js';
import { useCharacter, useKick, useSnapshot } from './useCharacter.js';
import './blocks.css';

export function BlocksApp() {
  const { snapshot, error } = useSnapshot();

  if (!snapshot) {
    return (
      <div className="sheet">
        <p className="boot">{error ?? 'READING TRANSCRIPTS…'}</p>
      </div>
    );
  }

  return <BlocksSheet snapshot={snapshot} />;
}

function BlocksSheet({ snapshot }: { snapshot: UsageSnapshot }) {
  const c = useCharacter(snapshot);
  const scoreRef = useKick(c.floaters.length);

  return (
    <div className={`sheet ${c.live ? 'live' : 'idle'}`}>
      <header className="top">
        <span className="mark">TOKEN TICKER</span>
        <span className="title">{c.titleOf.name}</span>
        <span className="derive">{c.titleOf.derivation}</span>
        <span className="spacer" />
        <span className="lamp">
          <i />
          {c.live ? 'LIVE' : 'IDLE'}
        </span>
      </header>

      <div className="grid">
        <section className="hero">
          <span className="lab">TOKENS TODAY</span>
          <div className="score" ref={scoreRef} aria-hidden>
            <Odometer value={full(c.todayShown)} />
          </div>
          <div className="pops" aria-hidden>
            {c.floaters.map((floater) => (
              <span
                className={floater.huge ? 'pop huge' : 'pop'}
                key={floater.id}
                style={{ ['--drift' as string]: `${floater.drift}px` }}
              >
                +{full(floater.tokens)}
              </span>
            ))}
          </div>
          <div className="chips">
            <span className="chip ink">{full(c.rate)} TOK/S</span>
            <span className="chip">{usd(c.todayUsd)} TODAY</span>
            <span className="chip">{count(c.todayTurns)} TURNS</span>
            <span className="chip">
              {c.combo > 0 ? `×${c.combo}` : 'NO'} CHAIN
              {c.comboTier ? ` · ${c.comboTier.name}` : ''}
            </span>
          </div>
          <p className="sr" role="status" aria-live="polite">
            {full(c.today)} tokens today, {count(c.todayTurns)} turns
          </p>
        </section>

        <div className="side">
          <section className="lvbox">
            <span className="lab">LEVEL</span>
            <div className="lv">
              {c.level.level}
              <sup>LV</sup>
            </div>
            <div className="bar">
              <i style={{ width: `${c.towardLevel * 100}%` }} />
            </div>
            <div className="barmeta">
              <span>{compact(c.level.into)}</span>
              <span>{compact(c.level.span)}</span>
            </div>
          </section>

          <section className="manabox">
            <span className="lab">MANA · 5H WINDOW</span>
            <div className="mananum">
              <Odometer value={full(c.manaShown)} />
            </div>
            <div className={`bar hatched ${band(c.manaShare)}`}>
              <i style={{ width: `${c.manaShare * 100}%` }} />
            </div>
            <div className="manaof">
              {c.ceiling
                ? `OF ${full(c.ceiling)} · ${Math.round(c.manaShare * 100)}%`
                : 'NO CEILING MEASURED YET'}
            </div>
            <div className="manasrc">
              {c.ceiling
                ? c.ceilingIsObserved
                  ? 'measured at a refusal'
                  : 'fallen back to your busiest window'
                : 'never been cut off'}
            </div>
          </section>
        </div>
      </div>

      <div className="row">
        <section className="box">
          <span className="lab">SKILLS · RANK AND PROGRESS</span>
          <div className="skills">
            {c.skillRows.map((skill) => (
              <div className="skill" key={skill.name}>
                <span className="nm">{skill.name}</span>
                <span className="vl">
                  {compact(skill.tokens)} · {share(skill.share)}
                  {skill.denominator === 'output' ? ' OF OUT' : ''}
                </span>
                <span className="rungs">
                  {[1, 2, 3, 4, 5].map((rung) => (
                    <i
                      className={rung <= skill.rank ? 'on' : rung === skill.rank + 1 ? 'part' : ''}
                      key={rung}
                      style={
                        rung === skill.rank + 1
                          ? { ['--fill' as string]: String(skill.towardRank) }
                          : undefined
                      }
                    />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="badgecol">
          <span className="lab">
            ACHIEVEMENTS · {c.earned} / {c.badges.length}
          </span>
          <div className="badges">
            {c.badges.map((badge) => (
              <div className={badge.earned ? 'badge on' : 'badge off'} key={badge.id}>
                <Icon name={badge.icon} />
                <span>
                  <span className="bt">{badge.name}</span>
                  <span className="bs">
                    {badge.earned
                      ? badge.note
                      : `${compact(badge.progress)} / ${compact(badge.goal)}`}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="records">
        <Record label="STREAK" value={c.streak > 0 ? `${c.streak}d` : '—'} />
        <Record label="BEST CHAIN" value={`×${c.snapshot.bestCombo}`} />
        <Record label="LIFETIME" value={full(c.lifetimeShown)} />
        <Record label="EQUIVALENT" value={usd(c.lifetimeUsd)} />
        <Record label="CUT OFF" value={count(c.snapshot.limitHits.length)} />
      </footer>
    </div>
  );
}

/** A share as a percentage, at the precision the size warrants. */
function share(value: number): string {
  const percent = value * 100;
  if (percent === 0) return '0%';
  // A thousandth of a percent is still something measured; `0.0%` would read
  // as nothing at all.
  if (percent < 0.1) return '<0.1%';
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

/** Which colour the allowance bar takes. Form as well as number. */
function band(share: number): string {
  if (share >= 0.85) return 'danger';
  if (share >= 0.6) return 'warn';
  return '';
}

function Record({ label, value }: { label: string; value: string }) {
  return (
    <div className="record">
      <span className="lab">{label}</span>
      <span className="rv">{value}</span>
    </div>
  );
}
