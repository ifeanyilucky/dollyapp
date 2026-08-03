/**
 * Background audio for the Audio panel — a handful of predefined ambient
 * loops, synthesized in-browser with Web Audio (the same technique
 * `clickSound.ts` already uses for the cursor click tick) rather than
 * bundled/fetched audio files. That sidesteps licensing a real music
 * library entirely: every preset is generated once per session from a
 * short recipe of oscillators/noise, rendered into a seamlessly-looping
 * `AudioBuffer` via an `OfflineAudioContext`, then cached — cheap enough to
 * regenerate per app launch, no asset download, no attribution to track.
 *
 * `BackgroundAudioPlayer` is the one piece of playback machinery shared by
 * both the live editor (`EditorView`, destination `ctx.destination`) and
 * export (`exportVideo.ts`, destination a `MediaStreamAudioDestinationNode`
 * that feeds the recorded output) — same "preview and export must never
 * diverge" principle the rest of the editor follows.
 */

const LOOP_SECONDS = 8;
const SAMPLE_RATE = 44100;
/** Fade applied at the very start/end of the rendered buffer so looping
 * back to the start doesn't produce an audible click at the seam. */
const LOOP_FADE_SECONDS = 0.08;

export interface AmbientTrackPreset {
  id: AmbientTrackId;
  label: string;
  mood: string;
}

export type AmbientTrackId = "calm-drone" | "soft-pulse" | "airy-chimes" | "gentle-rain" | "deep-focus";

export const AMBIENT_TRACK_PRESETS: AmbientTrackPreset[] = [
  { id: "calm-drone", label: "Calm Drone", mood: "Slow, warm, evolving pad" },
  { id: "soft-pulse", label: "Soft Pulse", mood: "Gentle rhythmic breathing" },
  { id: "airy-chimes", label: "Airy Chimes", mood: "Bright, sparse bell tones" },
  { id: "gentle-rain", label: "Gentle Rain", mood: "Soft, steady rainfall texture" },
  { id: "deep-focus", label: "Deep Focus", mood: "Low, subtle focus noise" },
];

export function isAmbientTrackId(id: string): id is AmbientTrackId {
  return AMBIENT_TRACK_PRESETS.some((p) => p.id === id);
}

function whiteNoiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Brown noise (integrated white noise) — much softer/deeper than raw
 * white noise, the basis for both the rain patter and the focus-noise bed
 * below. */
function brownNoiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

function loopingNoiseSource(ctx: OfflineAudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

/** Slow drifting pad — three detuned sine layers, each with its own gentle
 * gain LFO so the chord breathes instead of sitting static. */
function buildCalmDrone(ctx: OfflineAudioContext, out: AudioNode, seconds: number): void {
  const freqs = [110, 138.59, 164.81]; // A2, C#3, E3
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    gain.gain.value = 0.22;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06 + Math.random() * 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.08;
    lfo.connect(lfoGain).connect(gain.gain);

    osc.connect(gain).connect(out);
    osc.start(0);
    osc.stop(seconds);
    lfo.start(0);
    lfo.stop(seconds);
  }
}

/** A single low pad with a moderate-rate gain LFO — reads as a slow,
 * steady "breathing" pulse rather than a static tone. */
function buildSoftPulse(ctx: OfflineAudioContext, out: AudioNode, seconds: number): void {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 130.81; // C3

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 800;

  const gain = ctx.createGain();
  gain.gain.value = 0.28;

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.4;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.16;
  lfo.connect(lfoGain).connect(gain.gain);

  osc.connect(filter).connect(gain).connect(out);
  osc.start(0);
  osc.stop(seconds);
  lfo.start(0);
  lfo.stop(seconds);
}

/** Sparse pentatonic bell hits at fixed points across the loop — decaying
 * sine bursts rather than a continuous tone, for an "airy chime" feel. */
function buildAiryChimes(ctx: OfflineAudioContext, out: AudioNode, seconds: number): void {
  const scale = [523.25, 587.33, 659.25, 783.99, 880]; // C5 pentatonic
  const hitCount = 10;
  for (let i = 0; i < hitCount; i++) {
    const t = (i / hitCount) * seconds + Math.random() * 0.3;
    if (t >= seconds - 0.5) continue;
    const freq = scale[Math.floor(Math.random() * scale.length)];

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);

    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 1.7);
  }
}

/** Bandpassed white noise with a slow amplitude wobble — the classic
 * synthesis trick for a convincing rain/patter texture. */
function buildGentleRain(ctx: OfflineAudioContext, out: AudioNode, seconds: number): void {
  const noise = loopingNoiseSource(ctx, whiteNoiseBuffer(ctx, seconds));

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 3200;
  filter.Q.value = 0.6;

  const gain = ctx.createGain();
  gain.gain.value = 0.12;

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.15;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.03;
  lfo.connect(lfoGain).connect(gain.gain);

  noise.connect(filter).connect(gain).connect(out);
  noise.start(0);
  noise.stop(seconds);
  lfo.start(0);
  lfo.stop(seconds);
}

/** A low brown-noise bed under a very slow sub pad — deliberately close to
 * plain "focus noise" rather than anything melodic. */
function buildDeepFocus(ctx: OfflineAudioContext, out: AudioNode, seconds: number): void {
  const noise = loopingNoiseSource(ctx, brownNoiseBuffer(ctx, seconds));
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.value = 500;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.35;
  noise.connect(noiseFilter).connect(noiseGain).connect(out);
  noise.start(0);
  noise.stop(seconds);

  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 55; // A1
  const subGain = ctx.createGain();
  subGain.gain.value = 0.12;
  sub.connect(subGain).connect(out);
  sub.start(0);
  sub.stop(seconds);
}

const AMBIENT_BUILDERS: Record<AmbientTrackId, (ctx: OfflineAudioContext, out: AudioNode, seconds: number) => void> = {
  "calm-drone": buildCalmDrone,
  "soft-pulse": buildSoftPulse,
  "airy-chimes": buildAiryChimes,
  "gentle-rain": buildGentleRain,
  "deep-focus": buildDeepFocus,
};

async function renderAmbientBuffer(id: AmbientTrackId): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(LOOP_SECONDS * SAMPLE_RATE), SAMPLE_RATE);
  const fadeGain = ctx.createGain();
  fadeGain.connect(ctx.destination);
  fadeGain.gain.setValueAtTime(0, 0);
  fadeGain.gain.linearRampToValueAtTime(1, LOOP_FADE_SECONDS);
  fadeGain.gain.setValueAtTime(1, LOOP_SECONDS - LOOP_FADE_SECONDS);
  fadeGain.gain.linearRampToValueAtTime(0, LOOP_SECONDS);
  AMBIENT_BUILDERS[id](ctx, fadeGain, LOOP_SECONDS);
  return ctx.startRendering();
}

/** Rendered once per preset per session and reused for every subsequent
 * play — an `AudioBuffer` isn't tied to whichever context rendered it
 * (`AudioBufferSourceNode` resamples on the fly if needed), so the same
 * cached buffer backs both the live preview's `AudioContext` and export's
 * own. */
const ambientBufferCache = new Map<AmbientTrackId, Promise<AudioBuffer>>();

export function getAmbientBuffer(id: AmbientTrackId): Promise<AudioBuffer> {
  let cached = ambientBufferCache.get(id);
  if (!cached) {
    cached = renderAmbientBuffer(id);
    ambientBufferCache.set(id, cached);
  }
  return cached;
}

/** Fetches and decodes any fetchable audio URL into a real `AudioBuffer` —
 * a user-uploaded custom track's `blob:` URL (`AudioPanel`'s upload
 * handler), a `dol://` media URL (packed recordings' mic narration — see
 * `narration.ts`), or a `convertFileSrc`'d filesystem path (legacy
 * `.motionrec` bundles). Returns `null` on any failure (corrupt file,
 * unsupported codec, missing file) rather than throwing, so a bad track
 * just silently plays nothing instead of breaking playback/export. */
export async function decodeAudioFromUrl(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const resp = await fetch(url);
    const arrayBuffer = await resp.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Loops a background track through a volume/mute-controlled gain node into
 * whichever `destination` the caller wants (the live speakers for preview,
 * or a `MediaStreamAudioDestinationNode` for export — see the module doc
 * comment). `play`/`pause` mirror the main video's own play state; `setBuffer`
 * swaps the loop source live (e.g. picking a different preset) without
 * disturbing play state, since `AudioBufferSourceNode`s can only be started
 * once and can't be reused across a track change.
 */
export class BackgroundAudioPlayer {
  private ctx: AudioContext;
  private gainNode: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private playing = false;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.gainNode = ctx.createGain();
    this.gainNode.connect(destination);
  }

  setVolume(volume0to100: number, muted: boolean): void {
    this.gainNode.gain.value = muted ? 0 : volume0to100 / 100;
  }

  /** `null` clears the current track (background audio removed/none
   * selected) — stops playback if it was running. */
  setBuffer(buffer: AudioBuffer | null): void {
    this.buffer = buffer;
    if (this.playing) this.restart();
    else this.stop();
  }

  play(): void {
    this.playing = true;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (this.buffer) this.restart();
  }

  pause(): void {
    this.playing = false;
    this.stop();
  }

  dispose(): void {
    this.stop();
    this.gainNode.disconnect();
  }

  private restart(): void {
    this.stop();
    if (!this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.gainNode);
    src.start();
    this.source = src;
  }

  private stop(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // already stopped
    }
    this.source.disconnect();
    this.source = null;
  }
}
