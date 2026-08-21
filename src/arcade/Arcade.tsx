import { useEffect, useRef, useState } from 'react';
import { totalTokens, workTokens } from '../core/limits.js';
import {
  COMBO_GAP_MS,
  COMBO_TIERS,
  comboLength,
  comboTier,
  dailyStreak,
  levelFor,
  tokenRatePerSecond,
} from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import { subscribeToUsage } from '../ui/feed.js';
import { compact, count, full, todayKey, usd } from '../ui/format.js';
import { useNow, usePrevious } from '../ui/hooks.js';
import { Odometer } from '../ui/Odometer.js';
import { usePunchValue } from './punch.js';
import { fanfare, tick, unlockSfx } from './sfx.js';

const RATE_WINDOW_MS = 60_000;

interface Floater {
  id: number;
  text: string;
  x: number;
  kind: 'hit' | 'huge' | 'record';
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

interface Banner {
  id: number;
  text: string;
}

export function ArcadeApp() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let cancelled = false;
    const unsubscribe = subscribeToUsage(timeZone, {
      snapshot: (next) => {
        if (cancelled) return;
        setSnapshot(next);
        setError(null);
      },
      activity: () => undefined,
      error: (message) => {
        if (!cancelled) setError(message);
      },
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (!snapshot) {
    return (
      <div className="cabinet">
        <p className="boot">{error ?? 'INSERT COIN — reading transcripts…'}</p>
      </div>
    );
  }

  return <ArcadeHud snapshot={snapshot} />;
}

function ArcadeHud({ snapshot }: { snapshot: UsageSnapshot }) {
  const now = useNow(250);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [shake, setShake] = useState(0);
  const [muted, setMuted] = useState(true);
  const mutedRef = useRef(true);
  mutedRef.current = muted;

  const sparks = useRef<Spark[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scoreRef = useRef<HTMLDivElement>(null);

  const today = snapshot.byDay.find((bucket) => bucket.key === todayKey(snapshot.timeZone));
  const todayTokens = today ? totalTokens(today.totals.tokens) : 0;
  const shown = usePunchValue(todayTokens);
  const previous = usePrevious(todayTokens);

  const bestBefore = snapshot.byDay
    .filter((bucket) => bucket.key !== today?.key)
    .reduce((best, bucket) => Math.max(best, totalTokens(bucket.totals.tokens)), 0);
  const isRecord = todayTokens > bestBefore && bestBefore > 0;

  const lifetime = totalTokens(snapshot.totals.tokens);
  const lifetimeShown = usePunchValue(lifetime);
  const level = levelFor(lifetime);
  const previousLevel = usePrevious(level.level);

  const rate = tokenRatePerSecond(snapshot.recent, now, RATE_WINDOW_MS);
  const combo = comboLength(
    snapshot.recent.map((event) => event.at),
    now,
    COMBO_GAP_MS,
  );
  const previousCombo = usePrevious(combo);
  const tier = comboTier(combo);
  const nextTier = COMBO_TIERS.find((rung) => combo < rung.from);
  const streak = dailyStreak(
    snapshot.byDay.map((bucket) => bucket.key),
    todayKey(snapshot.timeZone),
  );

  const lastAt = snapshot.recent.at(-1)?.at;
  const sinceLast = lastAt ? now - Date.parse(lastAt) : Number.POSITIVE_INFINITY;
  const comboLeft = Math.max(0, 1 - sinceLast / COMBO_GAP_MS);
  const live = sinceLast < COMBO_GAP_MS;

  const w = snapshot.window.totals.tokens;
  const windowUsed = workTokens(w);
  const windowShown = usePunchValue(windowUsed);
  const peak = workTokens(snapshot.peak.totals.tokens);
  const ceiling = snapshot.observedCeiling ?? (peak > 0 ? peak : null);
  const hp = ceiling && ceiling > 0 ? Math.min(windowUsed / ceiling, 1) : 0;

  const towardNext = level.span > 0 ? level.into / level.span : 0;
  const towardRecord = bestBefore > 0 ? Math.min(todayTokens / bestBefore, 1) : 0;

  function shout(text: string) {
    const banner = { id: Date.now() + Math.random(), text };
    setBanners((current) => [...current.slice(-2), banner]);
    window.setTimeout(
      () => setBanners((current) => current.filter((entry) => entry.id !== banner.id)),
      1600,
    );
  }

  function burst(kind: Floater['kind']) {
    const origin = scoreRef.current?.getBoundingClientRect();
    const cx = origin ? origin.left + origin.width / 2 : window.innerWidth / 2;
    const cy = origin ? origin.top + origin.height * 0.45 : window.innerHeight / 3;
    const n = kind === 'huge' ? 42 : kind === 'record' ? 36 : 22;
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const speed = 2.4 + Math.random() * 6;
      sparks.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        life: 1,
        hue: kind === 'huge' ? 48 + Math.random() * 20 : kind === 'record' ? 12 + Math.random() * 18 : 42 + Math.random() * 30,
      });
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;

    const draw = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sparks.current = sparks.current.filter((spark) => spark.life > 0);
      for (const spark of sparks.current) {
        spark.x += spark.vx;
        spark.y += spark.vy;
        spark.vy += 0.12;
        spark.life -= 0.018;
        ctx.globalAlpha = Math.max(spark.life, 0);
        ctx.fillStyle = `hsl(${spark.hue} 100% 62%)`;
        ctx.fillRect(spark.x, spark.y, 3, 3);
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (previous === undefined) return;
    const gained = todayTokens - previous;
    if (gained <= 0) return;

    const huge = gained >= 1_000_000;
    const kind: Floater['kind'] = isRecord ? 'record' : huge ? 'huge' : 'hit';
    const floater: Floater = {
      id: Date.now(),
      text: `+${full(Math.round(gained))}`,
      x: (Math.random() * 48 - 24) | 0,
      kind,
    };
    setFloaters((current) => [...current.slice(-8), floater]);
    setShake((n) => n + 1);
    burst(kind);
    if (!mutedRef.current) tick(combo);
    if (huge) shout('HUGE SCORE');
    window.setTimeout(
      () => setFloaters((current) => current.filter((entry) => entry.id !== floater.id)),
      1400,
    );
  }, [todayTokens, previous, isRecord, combo]);

  useEffect(() => {
    if (previousLevel === undefined || level.level <= previousLevel) return;
    shout(`LEVEL ${level.level}`);
    if (!mutedRef.current) fanfare();
  }, [level.level, previousLevel]);

  useEffect(() => {
    if (previousCombo === undefined || combo <= previousCombo) return;
    const was = comboTier(previousCombo);
    if (tier && (!was || was.rank !== tier.rank)) {
      shout(tier.name);
      if (!mutedRef.current) fanfare();
    }
  }, [combo, previousCombo, tier]);

  useEffect(() => {
    const el = scoreRef.current;
    if (!el || shake === 0) return;
    el.classList.remove('punch');
    void el.offsetWidth;
    el.classList.add('punch');
  }, [shake]);

  async function toggleMute() {
    if (muted) {
      const ok = await unlockSfx();
      setMuted(!ok);
    } else {
      setMuted(true);
    }
  }

  const comboScale = 1 + Math.min(combo, 40) * 0.012;

  return (
    <div className={`cabinet ${live ? 'hot' : 'idle'}`}>
      <canvas className="sparks" ref={canvasRef} />
      <div className="scan" />
      <div className="vignette" />

      <header className="top">
        <span className="mark">
          <span className="mark-a">TOKEN</span>
          <span className="mark-b">ARCADE</span>
        </span>
        <span className={`lamp ${live ? 'on' : ''}`}>
          <span className="lamp-dot" />
          {live ? 'LIVE' : 'IDLE'}
        </span>
        <span className="top-space" />
        <button className="mute" type="button" onClick={() => void toggleMute()}>
          {muted ? 'SFX OFF' : 'SFX ON'}
        </button>
        <span className="zone">prototype · {snapshot.timeZone}</span>
      </header>

      <div className="stage">
        <aside className="rail left">
          <div className="combo-ring" style={{ ['--combo-left' as string]: String(comboLeft) }}>
            <div className="combo-core" style={{ transform: `scale(${comboScale})` }}>
              <span className="combo-label">COMBO</span>
              <span className="combo-num">{combo > 0 ? `×${combo}` : '—'}</span>
              <span className="combo-tier">{tier ? tier.name : combo > 0 ? 'FIRST HIT' : 'WAIT'}</span>
            </div>
          </div>
          <p className="rail-note">
            {nextTier
              ? `${nextTier.from - combo} to ${nextTier.name}`
              : `best ×${snapshot.bestCombo}`}
          </p>
        </aside>

        <div className="well">
          <div className="banners">
            {banners.map((banner) => (
              <span className="banner" key={banner.id}>
                {banner.text}
              </span>
            ))}
            {isRecord ? <span className="banner record">HIGH SCORE</span> : null}
          </div>

          <div className="score-label">TODAY</div>
          <div className="score" ref={scoreRef}>
            <Odometer value={full(Math.round(shown))} />
            <div className="pops">
              {floaters.map((floater) => (
                <span
                  className={`pop ${floater.kind}`}
                  key={floater.id}
                  style={{ ['--drift' as string]: `${floater.x}px` }}
                >
                  {floater.text}
                </span>
              ))}
            </div>
          </div>

          <div className="under">
            <span className="rate">
              {full(Math.round(rate))}
              <em> TOK/S</em>
            </span>
            <span className="worth">≈ {usd(today?.totals.usd ?? 0)}</span>
            <span className="turns">{count(today?.totals.turns ?? 0)} TURNS</span>
          </div>

          <div className="xp">
            <div className="xp-fill" style={{ width: `${towardNext * 100}%` }} />
          </div>
          <div className="xp-meta">
            <span>LV {level.level}</span>
            <span>
              {compact(level.into)} / {compact(level.span)}
            </span>
          </div>

          <div className="record-track">
            <div className="record-fill" style={{ width: `${towardRecord * 100}%` }} />
          </div>
          <div className="record-meta">
            {bestBefore > 0
              ? isRecord
                ? `beat ${compact(bestBefore)}`
                : `${compact(bestBefore - todayTokens)} to beat ${compact(bestBefore)}`
              : 'first day'}
          </div>
        </div>

        <aside className="rail right">
          <div className="boss">
            <span className="boss-label">SESSION HP</span>
            <span className="boss-num">
              <Odometer value={full(Math.round(windowShown))} />
            </span>
            <div className={`hp ${hp >= 0.85 ? 'danger' : hp >= 0.6 ? 'warn' : ''}`}>
              <div className="hp-fill" style={{ width: `${hp * 100}%` }} />
            </div>
            <span className="boss-of">{ceiling ? `of ${full(ceiling)}` : 'no ceiling yet'}</span>
          </div>
        </aside>
      </div>

      <footer className="stats">
        <Stat label="LIFETIME" value={full(Math.round(lifetimeShown))} />
        <Stat label="STREAK" value={streak > 0 ? `${streak}d` : '—'} />
        <Stat label="BEST COMBO" value={`×${snapshot.bestCombo}`} />
        <Stat label="WORTH" value={usd(snapshot.totals.usd)} />
        <Stat label="CUT OFF" value={count(snapshot.limitHits.length)} />
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
