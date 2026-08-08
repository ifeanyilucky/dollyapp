/**
 * Recorded-clip audio playback — the mic narration (`mic.wav`, see
 * `RecordingMeta.hasMicAudio`/`LoadedRecording.micAudioUrl`) and system
 * audio (`system.wav`, see `RecordingMeta.hasSystemAudio`/
 * `LoadedRecording.systemAudioUrl`), decoded once each and played in
 * lockstep with the main video, in both the live preview (`EditorView`)
 * and export (`exportVideo.ts`) — same "preview and export must never
 * diverge" principle as everything else in the editor. One `ClipAudioPlayer`
 * per recorded track; they differ only in which file/settings they're fed.
 *
 * Sync assumption: mic/system capture is started essentially at the same
 * instant as screen capture (see `src-tauri/src/recorder/macos.rs`'s
 * `start()` — all are kicked off from the same synchronous call, with no
 * measured offset recorded the way `RecordingMeta.videoStartUs` measures
 * the screen capture's *own* startup latency). `ClipAudioPlayer` therefore
 * treats each track's frame 0 as aligned with the video's own frame 0; if
 * that unmeasured gap is ever non-negligible in practice, real-world sync
 * will be off by however long it actually was. `resyncIfDrifted` is a
 * separate, narrower safety net — it only corrects for the two independent
 * playback clocks (`HTMLMediaElement` vs `AudioContext`) creeping apart
 * over a long playback, not for that initial fixed offset.
 */

/** How far `currentPosition()` is allowed to drift from the video's own
 * `currentTime` before `resyncIfDrifted` restarts the source to correct
 * it — large enough that ordinary scheduling jitter (a slow render frame,
 * GC pause) doesn't cause a restart on every tick, small enough that real
 * drift gets caught quickly. */
const RESYNC_THRESHOLD_SECONDS = 0.15;

/**
 * Plays a single non-looping buffer (unlike `BackgroundAudioPlayer`'s
 * always-looping ambient tracks), seekable to an arbitrary offset —
 * `playFrom` doubles as both "start playing" and "resync after a seek/
 * drift", since an `AudioBufferSourceNode` can't be repositioned in place
 * and has to be replaced.
 */
export class ClipAudioPlayer {
  private ctx: AudioContext;
  private gainNode: GainNode;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private playing = false;
  private startedAtCtxTime = 0;
  private startedAtOffset = 0;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.gainNode = ctx.createGain();
    this.gainNode.connect(destination);
  }

  setVolume(volume0to100: number, muted: boolean): void {
    this.gainNode.gain.value = muted ? 0 : volume0to100 / 100;
  }

  /** `null` means no recorded track (recording without mic/system enabled,
   * or a corrupt/undecodable file — see `decodeAudioFromUrl`). */
  setBuffer(buffer: AudioBuffer | null): void {
    this.buffer = buffer;
  }

  /** (Re)starts playback from `offsetSeconds` into the buffer — the one
   * entry point for every case that needs the source repositioned: an
   * actual pause -> play transition, a seek while already playing, or a
   * drift correction (see `resyncIfDrifted`). No-ops (silently) past the
   * end of the buffer, same as the video simply having nothing left to
   * play there. */
  playFrom(offsetSeconds: number): void {
    this.stopSource();
    this.playing = true;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (!this.buffer || offsetSeconds >= this.buffer.duration) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = false;
    src.connect(this.gainNode);
    const startOffset = Math.max(0, offsetSeconds);
    src.start(0, startOffset);
    this.source = src;
    this.startedAtCtxTime = this.ctx.currentTime;
    this.startedAtOffset = startOffset;
  }

  pause(): void {
    this.playing = false;
    this.stopSource();
  }

  /** Best-effort estimate of "how far into the buffer" playback currently
   * is, derived from the `AudioContext`'s own clock rather than tracked
   * independently — used by `resyncIfDrifted` to compare against the
   * video's `currentTime`. */
  currentPosition(): number {
    return this.startedAtOffset + (this.ctx.currentTime - this.startedAtCtxTime);
  }

  /** Called every frame during playback (see `EditorView`'s `tick` and
   * `exportVideo`'s render loop) — restarts the source at the video's
   * actual position if the two have drifted apart by more than
   * `RESYNC_THRESHOLD_SECONDS`. A no-op while paused. */
  resyncIfDrifted(videoTimeSeconds: number): void {
    if (!this.playing) return;
    if (Math.abs(this.currentPosition() - videoTimeSeconds) > RESYNC_THRESHOLD_SECONDS) {
      this.playFrom(videoTimeSeconds);
    }
  }

  dispose(): void {
    this.stopSource();
    this.gainNode.disconnect();
  }

  private stopSource(): void {
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
