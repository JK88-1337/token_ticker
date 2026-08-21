/**
 * Tiny coin-tick sounds. Muted until the player opts in — browsers block
 * audio until a gesture, and a surprise beep on load would be rude.
 */

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  return ctx;
}

export async function unlockSfx(): Promise<boolean> {
  const audio = context();
  if (!audio) return false;
  if (audio.state === 'suspended') await audio.resume();
  return audio.state === 'running';
}

export function tick(combo: number): void {
  const audio = ctx;
  if (!audio || audio.state !== 'running') return;

  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'square';
  const rank = Math.min(combo, 24);
  osc.frequency.setValueAtTime(420 + rank * 28, now);
  osc.frequency.exponentialRampToValueAtTime(880 + rank * 18, now + 0.07);
  gain.gain.setValueAtTime(0.05, now);
  gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.13);
}

export function fanfare(): void {
  const audio = ctx;
  if (!audio || audio.state !== 'running') return;

  const now = audio.currentTime;
  for (const [i, freq] of [523, 659, 784, 1046].entries()) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const at = now + i * 0.07;
    gain.gain.setValueAtTime(0.06, at);
    gain.gain.exponentialRampToValueAtTime(0.0008, at + 0.22);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.24);
  }
}
