import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { ZoomKeyframe } from "../motion-engine";
import { setExportDestination, writeExportFile, type LoadedRecording } from "./api";
import type { AnimationSettings } from "./animationSettings";
import { aspectRatioPreset, type AspectRatioId } from "./aspect";
import type { AudioSettings } from "./audioSettings";
import { BackgroundAudioPlayer, decodeAudioFromUrl, getAmbientBuffer, isAmbientTrackId } from "./backgroundAudio";
import type { CropRect } from "./crop";
import type { CursorSettings } from "./cursorSettings";
import { masksActiveAt, type MaskClip } from "./masks";
import { NarrationPlayer } from "./narration";
import { SceneRenderer } from "./renderer";
import { computeOutputSize, resolutionPreset, type ResolutionId } from "./resolution";
import { sliceAt, type ClipSlice } from "./slices";
import type { StyleSettings } from "./style";

const TARGET_BITRATE = 12_000_000;

export interface ExportOptions {
  loaded: LoadedRecording;
  zoomKeyframes: ZoomKeyframe[];
  /** Video-relative seconds the clip's in/out (amber bar) trim — export
   * renders only `[clipStartS, clipEndS)`. */
  clipStartS: number;
  clipEndS: number;
  slices: ClipSlice[];
  masks: MaskClip[];
  style: StyleSettings;
  showCursor: boolean;
  cursorSettings: CursorSettings;
  /** Animations panel settings — screen/cursor animation style, motion
   * blur. See `renderer.ts`'s `SceneRendererOptions`/`draw` for how these
   * reach `SceneRenderer`. */
  animationSettings: AnimationSettings;
  /** Audio panel settings — background track selection, volume, mute. See
   * `backgroundAudio.ts` for how the chosen track is resolved and mixed
   * into the exported stream. */
  audioSettings: AudioSettings;
  aspectRatioId: AspectRatioId;
  /** Output resolution tier — same one the live preview canvas rendered
   * at (see `resolution.ts`); "preview and export must never diverge". */
  resolution: ResolutionId;
  /** Confirmed crop, if any — a sub-window of the *recording* (source
   * point space, see `crop.ts`), same as what the live preview used.
   * `null` means the export is the entire recording, same as before crop
   * existed. */
  crop: CropRect | null;
  /** Called roughly once per exported frame with (seconds done, total
   * seconds) — for a progress indicator. */
  onProgress?: (exportedSeconds: number, totalSeconds: number) => void;
}

interface Container {
  mimeType: string;
  extension: string;
}

function pickContainer(): Container | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: Container[] = [
    { mimeType: "video/mp4;codecs=avc1", extension: "mp4" },
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm;codecs=vp9", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: "", extension: "webm" };
}

/** Whether this webview's canvas capture needs a manual `requestFrame()` per
 * drawn frame (`captureStream(0)` mode) or captures automatically on canvas
 * changes (older WebKit builds) — probed once on a scratch canvas so the
 * real export stream is created the right way. */
function manualFrameCapture(): boolean {
  const probe = document.createElement("canvas");
  const stream = probe.captureStream(0);
  const track = stream.getVideoTracks()[0] as { requestFrame?: () => void } | undefined;
  const manual = typeof track?.requestFrame === "function";
  for (const t of stream.getTracks()) t.stop();
  return manual;
}

function waitForEvent(target: EventTarget, event: string, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      target.removeEventListener(event, on);
      reject(new Error(`Timed out waiting for "${event}".`));
    }, timeoutMs);
    target.addEventListener(event, on, { once: true });
  });
}

function waitUntil(predicate: () => boolean, timeoutMs = 15_000, reason = "condition"): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${reason}.`));
      requestAnimationFrame(poll);
    };
    poll();
  });
}

/** `screen.mov` as a same-origin `blob:` URL, so drawing its frames onto the
 * export canvas doesn't taint it. Prefers `fetch` on the `asset:` protocol
 * (streamed by the webview); falls back to a raw-byte IPC read. */
async function loadVideoBlobUrl(path: string): Promise<{ url: string; revoke: () => void }> {
  try {
    const resp = await fetch(convertFileSrc(path));
    if (resp.ok) {
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      return { url, revoke: () => URL.revokeObjectURL(url) };
    }
  } catch {
    // fall through to the IPC read below
  }
  const buffer = await invoke<ArrayBuffer>("read_file_bytes", { path });
  const blob = new Blob([buffer]);
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

/** Resolves `AudioSettings.trackId` into a real, loopable `AudioBuffer` —
 * a built-in ambient preset, the user's uploaded file, or `null` for "no
 * track"/a custom upload that failed to decode. Shared with the live
 * preview's own resolution logic in `EditorView` (kept as two call sites
 * rather than one shared function only because one runs inside a React
 * effect and the other inside this plain async function — the actual
 * resolution rule is identical). */
async function resolveAudioBuffer(ctx: AudioContext, settings: AudioSettings): Promise<AudioBuffer | null> {
  if (!settings.trackId) return null;
  if (isAmbientTrackId(settings.trackId)) return getAmbientBuffer(settings.trackId);
  return settings.customAudioUrl ? decodeAudioFromUrl(ctx, settings.customAudioUrl) : null;
}

/**
 * Renders the whole recording through the same `SceneRenderer` the live
 * preview uses — so the exported movie is pixel-for-pixel what the preview
 * shows (ARCHITECTURE.md, "preview and export must never diverge") — into a
 * hidden canvas, captures it with `captureStream` + `MediaRecorder` as it
 * plays back in real time, and writes the finished file to wherever the user
 * picked in the save dialog.
 *
 * Everything applied in the editor is baked in: the zoom keyframes (all
 * timeline moves/trims), the amber-bar clip in/out trim, split slices
 * (removed slices skipped, per-slice speed + cursor override), masks
 * (sensitive/highlight, skipping `disabled` ones — see `masks.ts`),
 * background/shadow/padding styling, the animated cursor overlay
 * (style/size/click effects/idle-hide/loop), and the output aspect ratio.
 *
 * Returns the chosen destination path, or `null` if the user cancelled the
 * save dialog.
 */
export async function exportVideo(opts: ExportOptions): Promise<string | null> {
  const container = pickContainer();
  if (!container) {
    throw new Error("Video export isn't supported by this webview (MediaRecorder unavailable).");
  }
  if (typeof HTMLCanvasElement === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new Error("Video export isn't supported by this webview (canvas capture unavailable).");
  }

  const captureManually = manualFrameCapture();
  const canvas = document.createElement("canvas");

  const { loaded } = opts;
  const { display } = loaded.meta;

  // Resolution: caps the longer dimension at the chosen tier and never
  // upscales past the source pixels (see `computeOutputSize`'s doc
  // comment) — the exact same computation the live preview canvas used,
  // so the export is what the preview showed, not a separate guess. The
  // canvas matches the *output* aspect (not the source's) so the
  // background fills the whole frame, exactly like the preview. Entirely
  // unaffected by crop — crop changes what `SceneRenderer` treats as "the
  // recording" (passed into its constructor below), not this output
  // frame's own size, same as the live preview.
  const sourceAspect = display.widthPx / display.heightPx;
  const outputAspect = aspectRatioPreset(opts.aspectRatioId).ratio ?? sourceAspect;
  const { width, height } = computeOutputSize(
    resolutionPreset(opts.resolution).longEdge,
    display.widthPx,
    display.heightPx,
    outputAspect,
  );
  if (width < 2 || height < 2) {
    throw new Error("The export frame would be too small to encode.");
  }

  const bundleDir = loaded.screenVideoPath.split("/").slice(0, -1).join("/");
  const baseName = (loaded.screenVideoPath.split("/").pop() ?? "recording").replace(/\.motionrec$/, "");
  const dest = await save({
    title: "Export video",
    defaultPath: `${bundleDir}/${baseName}.${container.extension}`,
    filters: [{ name: "Video", extensions: [container.extension] }],
  });
  if (!dest) return null;
  await setExportDestination(dest);

  canvas.width = width;
  canvas.height = height;
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.opacity = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "-1";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't get a 2D context for the export canvas.");

  const renderer = new SceneRenderer({
    frame: { width: display.widthPx / display.scaleFactor, height: display.heightPx / display.scaleFactor },
    scaleFactor: display.scaleFactor,
    cursorTrack: loaded.cursorTrack,
    origin: { x: display.originX, y: display.originY },
    crop: opts.crop,
    outputAspect,
    zoomKeyframes: opts.zoomKeyframes,
    screenAnimationStyle: opts.animationSettings.screenAnimationStyle,
    cursorAnimationStyle: opts.animationSettings.cursorAnimationStyle,
  });

  const { url: videoUrl, revoke: revokeVideoUrl } = await loadVideoBlobUrl(loaded.screenVideoPath);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.display = "none";
  video.src = videoUrl;
  document.body.appendChild(video);

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let running = false;
  // Background audio + mic narration (Audio panel) share one mix context/
  // destination — only stood up at all when there's actually something to
  // mix (a background track selected, or the recording has a mic track),
  // so an export with neither costs nothing extra and behaves exactly as
  // it did before either of these existed.
  let audioMixCtx: AudioContext | null = null;
  let audioMixDestination: MediaStreamAudioDestinationNode | null = null;
  let bgAudioPlayer: BackgroundAudioPlayer | null = null;
  let narrationPlayer: NarrationPlayer | null = null;

  try {
    // Attaching this listener has to happen *before* any `await` runs, or
    // a fast-loading local `blob:` video (this one) can fire
    // `loadedmetadata` while we're still doing other async setup work —
    // the listener would then never see it and time out waiting for an
    // event that already happened. That's why the audio-mixing setup
    // below (which does real async decode work) comes *after* this, not
    // before it — it used to sit here and caused exactly that race.
    await waitForEvent(video, "loadedmetadata", 30_000);

    if (opts.audioSettings.trackId || loaded.meta.hasMicAudio) {
      audioMixCtx = new AudioContext();
      audioMixDestination = audioMixCtx.createMediaStreamDestination();

      if (opts.audioSettings.trackId) {
        bgAudioPlayer = new BackgroundAudioPlayer(audioMixCtx, audioMixDestination);
        bgAudioPlayer.setVolume(opts.audioSettings.volume, opts.audioSettings.muted);
        bgAudioPlayer.setBuffer(await resolveAudioBuffer(audioMixCtx, opts.audioSettings));
      }
      if (loaded.meta.hasMicAudio) {
        narrationPlayer = new NarrationPlayer(audioMixCtx, audioMixDestination);
        narrationPlayer.setVolume(opts.audioSettings.micVolume, opts.audioSettings.micMuted);
        narrationPlayer.setBuffer(await decodeAudioFromUrl(audioMixCtx, convertFileSrc(loaded.micAudioPath)));
      }
    }

    // Effective in/out, clamped to what the file actually contains.
    const videoClipEnd = opts.clipEndS > 0 ? Math.min(opts.clipEndS, video.duration) : video.duration;
    const videoClipStart = Math.min(Math.max(0, opts.clipStartS), videoClipEnd);
    if (videoClipEnd - videoClipStart < 0.05) {
      throw new Error("The clip to export is empty (check the trim).");
    }
    const totalSeconds = videoClipEnd - videoClipStart;
    const videoStartUs = loaded.meta.videoStartUs;
    const clipEndTUs = videoClipEnd * 1_000_000 + videoStartUs;

    // Park on the first frame so the recorder never starts on a blank canvas.
    video.currentTime = videoClipStart;
    await waitForEvent(video, "seeked", 30_000);
    await waitUntil(() => video.readyState >= 2, 15_000, "the video to decode");

    renderer.resetAt(videoClipStart * 1_000_000 + videoStartUs);

    const drawAt = (tS: number) => {
      const tUs = tS * 1_000_000 + videoStartUs;
      const active = sliceAt(opts.slices, tS);
      renderer.draw(
        ctx,
        video,
        tUs,
        opts.style,
        opts.showCursor,
        opts.cursorSettings,
        clipEndTUs,
        active?.cursorOverride ?? null,
        false,
        masksActiveAt(opts.masks, tS),
        null,
        opts.animationSettings,
      );
    };

    stream = canvas.captureStream(captureManually ? 0 : 30);
    if (audioMixDestination) {
      for (const audioTrack of audioMixDestination.stream.getAudioTracks()) stream.addTrack(audioTrack);
    }
    const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
    recorder = new MediaRecorder(stream, {
      ...(container.mimeType ? { mimeType: container.mimeType } : {}),
      videoBitsPerSecond: TARGET_BITRATE,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder!.onstop = () => resolve();
      recorder!.onerror = () => reject(new Error("MediaRecorder failed while exporting."));
    });

    // First frame before starting, so capture has something valid immediately.
    drawAt(videoClipStart);
    if (captureManually) track.requestFrame?.();
    running = true;
    recorder.start(1000);

    bgAudioPlayer?.play();
    // Narration starts from the clip's own trim-in offset, not 0 — see
    // `narration.ts`'s doc comment on the mic/screen-capture sync
    // assumption this relies on.
    narrationPlayer?.playFrom(videoClipStart);
    video.playbackRate = 1;
    await video.play();

    await new Promise<void>((resolve) => {
      const loop = () => {
        if (!running) return;
        const t = video.currentTime;

        // Removed slice: jump over it instead of drawing a frozen frame —
        // no `requestFrame`, so the jump itself doesn't land in the output.
        const active = sliceAt(opts.slices, t);
        if (active?.removed) {
          video.currentTime = Math.min(active.endS, video.duration ?? t);
          requestAnimationFrame(loop);
          return;
        }

        if (video.ended || t >= videoClipEnd) {
          resolve();
          return;
        }

        const rate = active?.speed ?? 1;
        if (Math.abs(video.playbackRate - rate) > 1e-6) video.playbackRate = rate;

        if (video.readyState >= 2) {
          drawAt(t);
          if (captureManually) track.requestFrame?.();
          opts.onProgress?.(t - videoClipStart, totalSeconds);
        }
        narrationPlayer?.resyncIfDrifted(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });

    video.pause();
    recorder.stop();
    await stopped;
    running = false;
    track.stop();

    const blob = new Blob(chunks, { type: container.mimeType || "video/webm" });
    if (blob.size === 0) throw new Error("The exporter produced an empty file.");

    await writeExportFile(new Uint8Array(await blob.arrayBuffer()));
    return dest;
  } finally {
    running = false;
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // already stopped
    }
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      // stream may be half-constructed
    }
    bgAudioPlayer?.dispose();
    narrationPlayer?.dispose();
    void audioMixCtx?.close();
    document.body.removeChild(canvas);
    document.body.removeChild(video);
    revokeVideoUrl();
    video.removeAttribute("src");
    video.load();
  }
}
