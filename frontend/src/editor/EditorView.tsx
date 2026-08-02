import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { generateZoomKeyframes, splitKeyframeAt, type ZoomKeyframe } from "../motion-engine";
import { aspectRatioPreset, type AspectRatioId } from "./aspect";
import { deleteRecording, loadRecording, revealInFinder, type LoadedRecording } from "./api";
import { playClickSound } from "./clickSound";
import { CursorPanel } from "./CursorPanel";
import { DEFAULT_CURSOR_SETTINGS, type CursorSettings } from "./cursorSettings";
import { IconRail, type ToolId } from "./IconRail";
import { SceneRenderer, shiftCursorTrack } from "./renderer";
import { initialSlices, resizeSlices, sliceAt, splitSliceAt, type ClipSlice } from "./slices";
import { SliceEditorPanel } from "./SliceEditorPanel";
import { StylePanel } from "./StylePanel";
import { DEFAULT_STYLE, type StyleSettings } from "./style";
import { Timeline } from "./Timeline";
import { nextPlaybackRate, TopBar } from "./TopBar";
import { ZoomEditorPanel } from "./ZoomEditorPanel";

// Fallback box used only for the first render, before the wrapper's real
// size has been measured (see the `ResizeObserver` effect below).
const FALLBACK_PREVIEW_WIDTH = 760;
const FALLBACK_PREVIEW_HEIGHT = 560;

/**
 * Post-recording preview: plays `screen.mov` through the same motion
 * engine export will eventually use (ARCHITECTURE.md, "preview and export
 * must never diverge"), with auto-generated zoom/pan that follows the live
 * cursor, an animated cursor overlay, background/padding/shadow styling,
 * an output aspect ratio switch, and split-based clip slices (speed +
 * per-slice cursor override). No true export (motion baked into an output
 * file) yet — slices/zoom edits, like everything else here, only affect
 * preview playback.
 */
export function EditorView({ bundlePath, onClose }: { bundlePath: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState<LoadedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [style, setStyle] = useState<StyleSettings>(DEFAULT_STYLE);
  const [showCursor, setShowCursor] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [aspectRatioId, setAspectRatioId] = useState<AspectRatioId>("original");
  const [zoomKeyframes, setZoomKeyframes] = useState<ZoomKeyframe[]>([]);
  // Effective in/out of the whole clip (video-relative seconds). Defaults to
  // the full source range once the video metadata loads; trimming the amber
  // timeline bar writes these, and the render loop/seek clamp playback to
  // them so nothing plays before `clipStartS` or after `clipEndS`.
  const [clipStartS, setClipStartS] = useState(0);
  const [clipEndS, setClipEndS] = useState(0);
  // Always tiles `[clipStartS, clipEndS)` with no gaps — see `slices.ts`.
  const [slices, setSlices] = useState<ClipSlice[]>([]);
  const [selectedSliceId, setSelectedSliceId] = useState<string | null>(null);
  const [selectedZoomIndex, setSelectedZoomIndex] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>("style");
  const [cursorSettings, setCursorSettings] = useState<CursorSettings>(DEFAULT_CURSOR_SETTINGS);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  // Tracks the actual on-screen size of the empty area around the canvas —
  // fed straight into `canvasWidth`/`canvasHeight` below so the preview
  // always fills the space it's given (resizing the window, opening a
  // slice/zoom editor panel, etc.) instead of sitting at a fixed size with
  // empty space around it.
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // Style/cursor-visibility/slice changes can fire rapidly (slider drags,
  // slice edits) or need to be read from a rAF loop that shouldn't
  // restart every tick — refs let `tick` always see the latest value
  // without becoming a dependency of the render-loop effect.
  const styleRef = useRef(style);
  styleRef.current = style;
  const showCursorRef = useRef(showCursor);
  showCursorRef.current = showCursor;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const slicesRef = useRef(slices);
  slicesRef.current = slices;
  const clipStartRef = useRef(clipStartS);
  clipStartRef.current = clipStartS;
  const clipEndRef = useRef(clipEndS);
  clipEndRef.current = clipEndS;
  const cursorSettingsRef = useRef(cursorSettings);
  cursorSettingsRef.current = cursorSettings;
  // `AudioContext` is created lazily, the first time a click sound is
  // actually needed — browsers want that to happen after a user gesture
  // has occurred somewhere on the page, which is already true by the time
  // playback (itself gesture-triggered) reaches a click event.
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Only sounds for click events strictly after this get played — sourced
  // from `tick`'s own `tUs` each frame and reset on seek, so a scrub never
  // replays every click between the old and new position at once.
  const lastSoundCheckTUsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    loadRecording(bundlePath)
      .then((rec) => {
        if (!cancelled) {
          setLoaded(rec);
          // Generated from the *origin-shifted* track, matching what
          // `SceneRenderer` builds internally (see its constructor) — a
          // keyframe's `center` has to land in the same video-local space
          // the renderer works in, or panning targets the wrong spot for
          // any window/area recording (non-zero display origin).
          const origin = { x: rec.meta.display.originX, y: rec.meta.display.originY };
          const shifted = shiftCursorTrack(rec.cursorTrack, origin);
          setZoomKeyframes(generateZoomKeyframes(shifted, { factor: 1 }));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [bundlePath]);

  // Build the renderer once the bundle's loaded — cursor coordinates are
  // in point space, so the motion engine gets point-space frame
  // dimensions, not the video's actual pixel dimensions (ARCHITECTURE.md,
  // "Recording format"). Deliberately *not* keyed on `aspectRatioId` or
  // `zoomKeyframes` — switching/editing those later goes through
  // `renderer.setOutputAspect`/`setZoomKeyframes` instead (see the effects
  // below), so they apply in place rather than recreating the renderer
  // and resetting playback.
  useEffect(() => {
    if (!loaded) return;
    const { widthPx, heightPx, scaleFactor, originX, originY } = loaded.meta.display;
    rendererRef.current = new SceneRenderer({
      frame: { width: widthPx / scaleFactor, height: heightPx / scaleFactor },
      scaleFactor,
      cursorTrack: loaded.cursorTrack,
      origin: { x: originX, y: originY },
      outputAspect: aspectRatioPreset(aspectRatioId).ratio ?? undefined,
      zoomKeyframes,
    });
    rendererRef.current.resetAt(loaded.meta.videoStartUs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Live aspect-ratio switch — reshapes the existing renderer's viewport
  // instead of rebuilding it (see the effect above).
  useEffect(() => {
    if (!loaded) return;
    rendererRef.current?.setOutputAspect(aspectRatioPreset(aspectRatioId).ratio ?? undefined);
  }, [loaded, aspectRatioId]);

  // Live zoom-keyframe edits (move/trim/split in the timeline, or the zoom
  // editor panel) — this is the fix for the preview never matching what
  // the timeline showed: the renderer used to generate its *own*,
  // independent copy of these keyframes internally and never learned
  // about edits made here. Now `zoomKeyframes` is the single source of
  // truth for both the timeline's visualization and actual playback.
  useEffect(() => {
    if (!loaded) return;
    rendererRef.current?.setZoomKeyframes(zoomKeyframes);
  }, [loaded, zoomKeyframes]);

  // Releases the click-sound `AudioContext` (if one was ever created) when
  // the editor closes, rather than leaking it for as long as the app runs.
  useEffect(() => {
    return () => {
      void audioCtxRef.current?.close();
    };
  }, []);

  // Keeps `containerSize` in sync with the wrapper's actual rendered box —
  // fires on window resize, but also on anything else that changes the
  // available space (opening a slice/zoom editor panel narrows it, closing
  // one widens it again), which a plain `window.resize` listener would miss.
  // Keyed on `loaded`: the wrapper div only exists once the "Loading…"
  // placeholder is replaced by the real editor UI, so an empty deps array
  // here would fire once too early (ref still null, no-op forever) and
  // never re-run once the div actually mounts.
  useEffect(() => {
    if (!loaded) return;
    const el = canvasWrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loaded]);

  // Render loop: reads `video.currentTime` directly every animation
  // frame rather than relying on the `timeupdate` event, which fires far
  // less often than 60fps.
  useEffect(() => {
    if (!loaded) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!video || !canvas || !ctx) return;

    let raf = 0;
    const tick = () => {
      const renderer = rendererRef.current;
      if (renderer && video.readyState >= 2) {
        const activeSlice = sliceAt(slicesRef.current, video.currentTime);

        // A removed slice isn't spliced out of the underlying file (there's
        // no export pipeline to bake that into yet) — instead, playback
        // simply jumps over it the instant it's entered, whether that's
        // from continuous playback reaching it or a seek landing inside
        // it. `duration || video.currentTime` guards the (astronomically
        // unlikely) case where a slice's own end is right at the clip's
        // end and floating-point rounding would otherwise land exactly on
        // `duration`, which the video element can react to as "ended".
        if (activeSlice?.removed) {
          video.currentTime = Math.min(activeSlice.endS, video.duration || video.currentTime);
          raf = requestAnimationFrame(tick);
          return;
        }

        // Clip in/out — the timeline's amber bar trim. Nothing plays before
        // `clipStartS` or past `clipEndS`; hitting the end pauses. `clipEndS`
        // is 0 until the video metadata loads, so guard on it to avoid
        // clamping a pre-metadata video straight to 0 on the first tick.
        const clipEnd = clipEndRef.current;
        if (clipStartRef.current > 0 && video.currentTime < clipStartRef.current) {
          video.currentTime = clipStartRef.current;
        } else if (clipEnd > 0 && video.currentTime >= clipEnd) {
          video.currentTime = clipEnd;
          video.pause();
        }

        const effectiveRate = playbackRateRef.current * (activeSlice?.speed ?? 1);
        if (Math.abs(video.playbackRate - effectiveRate) > 1e-6) {
          video.playbackRate = effectiveRate;
        }

        const tUs = video.currentTime * 1_000_000 + loaded.meta.videoStartUs;
        const clipEndTUs = clipEndRef.current * 1_000_000 + loaded.meta.videoStartUs;

        // Only while actually playing forward — not on every redrawn scrub
        // frame — and only for click events strictly between the last
        // check and now, so a seek can't replay a burst of old sounds.
        if (cursorSettingsRef.current.clickSoundEnabled && !video.paused) {
          const from = lastSoundCheckTUsRef.current;
          if (
            tUs > from &&
            loaded.cursorTrack.events.some(
              (e) => (e.kind === "leftDown" || e.kind === "rightDown") && e.t > from && e.t <= tUs,
            )
          ) {
            if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
            if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
            playClickSound(audioCtxRef.current);
          }
        }
        lastSoundCheckTUsRef.current = tUs;

        renderer.draw(
          ctx,
          video,
          tUs,
          styleRef.current,
          showCursorRef.current,
          cursorSettingsRef.current,
          clipEndTUs,
          activeSlice?.cursorOverride ?? null,
        );
        setCurrentTime(video.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loaded]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      // Respect the clip in/out: never resume from before `clipStartS`, and
      // restart from the top if playback had already reached the end.
      if (clipEndS > 0 && video.currentTime >= clipEndS) video.currentTime = clipStartS;
      else if (video.currentTime < clipStartS) video.currentTime = clipStartS;
      void video.play();
    } else video.pause();
  }

  function handleSeek(seconds: number) {
    const video = videoRef.current;
    if (!video || !loaded) return;
    const clamped = Math.max(clipStartS, Math.min(seconds, clipEndS));
    video.currentTime = clamped;
    const tUs = clamped * 1_000_000 + loaded.meta.videoStartUs;
    rendererRef.current?.resetAt(tUs);
    // A seek shouldn't replay every click sound between the old and new
    // position — see `tick`'s own comment on this ref.
    lastSoundCheckTUsRef.current = tUs;
    setCurrentTime(clamped);
  }

  /** Writes the amber timeline bar's in/out window (video-relative
   * seconds) and re-tiles `slices` to match. */
  function trimVideoClip(startS: number, endS: number) {
    setClipStartS(startS);
    setClipEndS(endS);
    setSlices((prev) => resizeSlices(prev, startS, endS));
  }

  function cyclePlaybackRate() {
    // Doesn't set `video.playbackRate` directly — the render loop already
    // does that every tick, combining this with any active slice's speed
    // (see `tick`'s `effectiveRate`).
    setPlaybackRate(nextPlaybackRate(playbackRate));
  }

  async function handleDelete() {
    if (!window.confirm("Delete this recording? This can't be undone.")) return;
    await deleteRecording(bundlePath);
    onClose();
  }

  function handleSplitClip(atS: number) {
    setSlices((prev) => splitSliceAt(prev, atS));
  }

  function handleSplitZoom(index: number, atT: number) {
    setZoomKeyframes((prev) => splitKeyframeAt(prev, index, atT));
  }

  function selectSlice(id: string) {
    setSelectedSliceId(id);
    setSelectedZoomIndex(null);
  }

  function selectZoomKeyframe(index: number) {
    setSelectedZoomIndex(index);
    setSelectedSliceId(null);
  }

  function updateSlice(next: ClipSlice) {
    setSlices((prev) => prev.map((s) => (s.id === next.id ? next : s)));
  }

  function applySpeedToAllSlices() {
    const selected = slices.find((s) => s.id === selectedSliceId);
    if (!selected) return;
    setSlices((prev) => prev.map((s) => ({ ...s, speed: selected.speed })));
  }

  function removeSlice() {
    if (!selectedSliceId) return;
    setSlices((prev) => prev.map((s) => (s.id === selectedSliceId ? { ...s, removed: true } : s)));
  }

  function updateZoomKeyframe(next: ZoomKeyframe) {
    if (selectedZoomIndex === null) return;
    setZoomKeyframes((prev) => prev.map((k, i) => (i === selectedZoomIndex ? next : k)));
  }

  function applyZoomLevelToAll() {
    if (selectedZoomIndex === null) return;
    const level = zoomKeyframes[selectedZoomIndex].level;
    setZoomKeyframes((prev) => prev.map((k) => ({ ...k, level })));
  }

  function removeZoomKeyframe() {
    if (selectedZoomIndex === null) return;
    setZoomKeyframes((prev) => prev.filter((_, i) => i !== selectedZoomIndex));
    setSelectedZoomIndex(null);
  }

  if (error) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-neutral-950 text-neutral-300">
        <p className="max-w-sm text-center text-sm text-red-400">{error}</p>
        <button type="button" onClick={onClose} className="text-xs text-neutral-500 underline">
          Back
        </button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-500">
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  const sourceAspect = loaded.meta.display.widthPx / loaded.meta.display.heightPx;
  const outputAspect = aspectRatioPreset(aspectRatioId).ratio ?? sourceAspect;
  // Fit the *chosen output* aspect ratio (not necessarily the source
  // recording's own shape — see the aspect-ratio switcher in `TopBar`)
  // within the actual measured wrapper box, both ways — a vertical/square
  // output needs a height cap too, not just the width cap a landscape one
  // would ever hit. Sized off `containerSize` (live, via the
  // `ResizeObserver` effect above) rather than a fixed constant, so the
  // preview always fills whatever space it's actually given instead of
  // sitting at a fixed size with empty space around it; falls back to a
  // fixed box only for the one frame before the observer's first callback.
  const boxWidth = containerSize.width || FALLBACK_PREVIEW_WIDTH;
  const boxHeight = containerSize.height || FALLBACK_PREVIEW_HEIGHT;
  let canvasWidth = boxWidth;
  let canvasHeight = Math.round(canvasWidth / outputAspect);
  if (canvasHeight > boxHeight) {
    canvasHeight = boxHeight;
    canvasWidth = Math.round(canvasHeight * outputAspect);
  }

  const selectedSlice = slices.find((s) => s.id === selectedSliceId);
  const selectedZoomKeyframe = selectedZoomIndex !== null ? zoomKeyframes[selectedZoomIndex] : undefined;

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-300">
      <TopBar
        title={bundlePath.split("/").pop() ?? bundlePath}
        aspectRatioId={aspectRatioId}
        onChangeAspectRatio={setAspectRatioId}
        showCursor={showCursor}
        onToggleCursor={() => setShowCursor((v) => !v)}
        playbackRate={playbackRate}
        onCyclePlaybackRate={cyclePlaybackRate}
        onRevealInFinder={() => void revealInFinder(bundlePath)}
        onDelete={() => void handleDelete()}
        onClose={onClose}
      />

      {/* `min-h-0` on this row and `min-w-0`/`min-h-0` on the canvas well
       * below override flexbox's default `min-width/height: auto`, which
       * otherwise floors a flex item at its content's intrinsic size —
       * without it, shrinking the window doesn't shrink the canvas, it
       * just gets silently clipped by `overflow-hidden` instead. */}
      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-4 overflow-hidden p-6">
        <div ref={canvasWrapperRef} className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            className="max-h-full max-w-full rounded-lg"
          />
        </div>
        <IconRail active={selectedSlice || selectedZoomKeyframe ? null : activeTool} onSelect={setActiveTool} />
        {selectedSlice ? (
          <SliceEditorPanel
            slice={selectedSlice}
            onChange={updateSlice}
            onApplySpeedToAll={applySpeedToAllSlices}
            onRemove={removeSlice}
            canRemove={slices.filter((s) => !s.removed).length > 1}
            onClose={() => setSelectedSliceId(null)}
          />
        ) : selectedZoomKeyframe ? (
          <ZoomEditorPanel
            keyframe={selectedZoomKeyframe}
            onChange={updateZoomKeyframe}
            onApplyLevelToAll={applyZoomLevelToAll}
            onRemove={removeZoomKeyframe}
            onClose={() => setSelectedZoomIndex(null)}
          />
        ) : activeTool === "cursor" ? (
          <CursorPanel
            settings={cursorSettings}
            onChange={setCursorSettings}
            showCursor={showCursor}
            onToggleShowCursor={() => setShowCursor((v) => !v)}
          />
        ) : (
          <StylePanel style={style} onChange={setStyle} />
        )}
      </div>

      {/* Hidden — used purely as a decoded-frame source for the canvas. */}
      <video
        ref={videoRef}
        src={convertFileSrc(loaded.screenVideoPath)}
        className="hidden"
        preload="auto"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setDuration(d);
          setClipStartS(0);
          setClipEndS(d);
          setSlices(initialSlices(0, d));
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      <div className="px-6 pb-6">
        <Timeline
          duration={duration}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
          onSeek={handleSeek}
          zoomKeyframes={zoomKeyframes}
          videoStartUs={loaded.meta.videoStartUs}
          clipStartS={clipStartS}
          clipEndS={clipEndS}
          onTrimVideoClip={trimVideoClip}
          onChangeZoomKeyframes={setZoomKeyframes}
          slices={slices}
          onSplitClip={handleSplitClip}
          onSelectSlice={selectSlice}
          onSplitZoomKeyframe={handleSplitZoom}
          onSelectZoomKeyframe={selectZoomKeyframe}
        />
      </div>
    </div>
  );
}
