/**
 * Synthesizes a short "click" sound with the Web Audio API rather than
 * shipping a bundled audio asset — a couple of oscillators with a fast
 * attack/decay envelope is enough for a clean, unobtrusive tick, and it
 * means `CursorSettings.clickSoundEnabled` works with zero extra files.
 */
export function playClickSound(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(900, now);
  osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.09);
}
