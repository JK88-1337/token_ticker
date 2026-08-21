/**
 * Gauge — the character sheet as a precision instrument.
 *
 * Hairlines, a strict three-column grid, and tabular figures. The orange is
 * used for fills and never for text: on the cream ground it clears about
 * 2.5:1, which is fine behind a bar and nowhere near enough for a numeral,
 * so every figure is set in the deep rust that carries the contrast.
 */

import type { UsageSnapshot } from '../core/snapshot.js';
import { Odometer } from '../ui/Odometer.js';
import { compact, count, dayKeyBefore, full, usd } from '../ui/format.js';
import { Icon } from './Icon.js';
import type { Character } from './useCharacter.js';
import { useKick, useSnapshot, useCharacter } from './useCharacter.js';
import './gauge.css';

/** How many days of the strip along the bottom of the allowance column. */
const STRIP_DAYS = 14;

export function GaugeApp() {
  const { snapshot, error } = useSnapshot();

  if (!snapshot) {
    return (
      <div className="sheet">
        <p className="boot">{error ?? 'reading transcripts…'}</p>
      </div>
    );
  }

  return <GaugeSheet snapshot={snapshot} />;
}

function GaugeSheet({ snapshot }: { snapshot: UsageSnapshot }) {
  const c = useCharacter(snapshot);
  const scoreRef = useKick(c.floaters.length);

  return (
    <div className={`sheet ${c.live ? 'live' : 'idle'}`}>
      <header className="top">
        <span className="mark">TOKEN&nbsp;TICKER</span>
        <span className="title">{c.titleOf.name}</span>
        <span className="derive">{c.titleOf.derivation}</span>
        <span className="spacer" />
        <span className="lamp">
          <i />
          {c.live ? 'LIVE' : 'IDLE'}
        </span>
      </header>

      <div className="main">
        <section className="col level">
          <span className="lab">LEVEL</span>
          <span className="lv">
            {c.level.level}
            <sup>LV</sup>
          </span>
          <div className="track">
            <i style={{ width: `${c.towardLevel * 100}%` }} />
          </div>
          <div className="trackmeta">
            <span>{compact(c.level.into)}</span>
            <span>{compact(c.level.span)}</span>
          </div>
          <div className="lifetime">
            <span className="lab">LIFETIME</span>
            <div className="lifenum">{full(c.lifetimeShown)}</div>
            <span className="lab">EQUIVALENT VALUE</span>
            <div className="lifeusd">{usd(c.lifetimeUsd)}</div>
          </div>
        </section>

        <section className="col hero">
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
          <div className="under">
            <b>{full(c.rate)}</b>
            <span>TOK/S</span>
            <b>{usd(c.todayUsd)}</b>
            <span>TODAY</span>
            <b>{count(c.todayTurns)}</b>
            <span>TURNS</span>
          </div>
          <p className="sr" role="status" aria-live="polite">
            {full(c.today)} tokens today, {count(c.todayTurns)} turns
          </p>
        </section>

        <section className="col mana">
          <span className="lab">MANA · 5H WINDOW</span>
          <div className="mananum">
            <Odometer value={full(c.manaShown)} />
          </div>
          <div className={`track ${band(c.manaShare)}`}>
            <i style={{ width: `${c.manaShare * 100}%` }} />
          </div>
          <div className="manaof">
            {c.ceiling
              ? `of ${full(c.ceiling)} · ${Math.round(c.manaShare * 100)}%`
              : 'no ceiling measured yet'}
          </div>
          <div className="manasrc">
            {c.ceiling
              ? c.ceilingIsObserved
                ? 'ceiling observed at a refusal'
                : 'ceiling fallen back to your busiest window'
              : 'never been cut off'}
          </div>

          <span className="lab strip-lab">LAST {STRIP_DAYS} DAYS</span>
          <DayStrip character={c} />
        </section>
      </div>

      <div className="lower">
        <section>
          <span className="lab">SKILLS · RANK PROGRESS</span>
          <div className="skills">
            {c.skillRows.map((skill) => (
              <div className="skill" key={skill.name}>
                <span className="nm">{skill.name}</span>
                <span className="bar">
                  <i style={{ width: `${skill.towardRank * 100}%` }} />
                </span>
                <span className="vl">{compact(skill.tokens)}</span>
                <span className="of">
                  {share(skill.share)} {skill.denominator === 'output' ? 'of out' : ''}
                </span>
                <span className="dots">
                  {[1, 2, 3, 4, 5].map((rung) => (
                    <i className={rung <= skill.rank ? 'on' : ''} key={rung} />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <span className="lab">
            ACHIEVEMENTS · {c.earned} / {c.badges.length}
          </span>
          <div className="badges">
            {c.badges.map((badge) => (
              <div className={badge.earned ? 'badge' : 'badge off'} key={badge.id}>
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
        </section>
      </div>

      <footer className="records">
        <Record label="STREAK" value={c.streak > 0 ? `${c.streak}d` : '—'} />
        <Record
          label="COMBO"
          value={c.combo > 0 ? `×${c.combo}` : '—'}
          note={c.comboTier?.name ?? (c.toNextTier !== null ? `${c.toNextTier} to next` : '')}
        />
        <Record label="BEST COMBO" value={`×${c.snapshot.bestCombo}`} />
        <Record label="CUT OFF" value={count(c.snapshot.limitHits.length)} />
        <Record label="ZONE" value={c.snapshot.timeZone} />
      </footer>
    </div>
  );
}

/**
 * A share as a percentage, at the precision the size warrants.
 *
 * Cache reads take almost every total, which leaves the other classes under a
 * percent — rounding those to `0%` would read as nothing measured at all.
 */
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

/**
 * Whether each of the last days saw any usage, oldest first.
 *
 * A binary strip rather than a bar chart: at this size the only question
 * worth answering is whether the streak has a hole in it. The keys are
 * generated from the calendar rather than taken from `byDay` — `byDay` only
 * holds days that saw work, so reading the strip off it would draw an
 * unbroken run no matter how many days were missed.
 */
function DayStrip({ character }: { character: Character }) {
  const used = new Set(character.snapshot.byDay.map((bucket) => bucket.key));
  const zone = character.snapshot.timeZone;
  const keys = Array.from({ length: STRIP_DAYS }, (_unused, index) =>
    dayKeyBefore(zone, STRIP_DAYS - 1 - index),
  );

  return (
    <div className="strip">
      {keys.map((key, index) => (
        <i
          className={index === keys.length - 1 ? 'today' : used.has(key) ? 'on' : ''}
          key={key}
          title={`${key}${used.has(key) ? '' : ' · nothing'}`}
        />
      ))}
    </div>
  );
}

function Record({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="record">
      <span className="lab">{label}</span>
      <span className="rv">{value}</span>
      {note ? <span className="rn">{note}</span> : null}
    </div>
  );
}
