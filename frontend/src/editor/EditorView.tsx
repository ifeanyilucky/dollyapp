import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { generateZoomKeyframes, type ZoomKeyframe } from "../motion-engine";
import { aspectRatioPreset, type AspectRatioId } from "./aspect";
import { deleteRecording, loadRecording, revealInFinder, type LoadedRecording } from "./api";
import { IconRail } from "./IconRail";
import {
  addRegion,
  regionAt,
  removeRegion,
  SPEED_REGION_RATES,
  type CutRegion,
  type SpeedRegion,
} from "./regions";
import { SceneRenderer, shiftCursorTrack } from "./renderer";
import { StylePanel } from "./StylePanel";
import { DEFAULT_STYLE, type StyleSettings } from "./style";
import { Timeline } from "./Timeline";
import { nextPlaybackRate, TopBar } from "./TopBar";

const MAX_PREVIEW_WIDTH = 760;
const MAX_PREVIEW_HEIGHT = 560;

/**
 * Post-recording preview: plays `screen.mov` through the same motion
 * engine export will eventually use (ARCHITECTURE.md, "preview and export
 * must never diverge"), with auto-generated zoom/pan that follows the live
 * cursor, an animated cursor overlay, background/padding/shadow styling,
 * an output aspect ratio switch, and cut/speed regions. No true export
 * (motion baked into an output file) yet — cut/speed, like everything
 * else here, only affects preview playback.
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
  const [cutRegions, setCutRegions] = useState<CutRegion[]>([]);
  const [speedRegions, setSpeedRegions] = useState<SpeedRegion[]>([]);
  const [zoomKeyframes, setZoomKeyframes] = useState<ZoomKeyframe[]>([]);
  // Effective in/out of the whole clip (video-relative seconds). Defaults to
  // the full source range once the video metadata loads; trimming the amber
  // timeline bar writes these, and the render loop/seek clamp playback to
  // them so nothing plays before `clipStartS` or after `clipEndS`.
  const [clipStartS, setClipStartS] = useState(0);
  const [clipEndS, setClipEndS] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  // Style/cursor-visibility/region changes can fire rapidly (slider drags,
  // region drags) or need to be read from a rAF loop that shouldn't
  // restart every tick — refs let `tick` always see the latest value
  // without becoming a dependency of the render-loop effect.
  const styleRef = useRef(style);
  styleRef.current = style;
  const showCursorRef = useRef(showCursor);
  showCursorRef.current = showCursor;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const cutRegionsRef = useRef(cutRegions);
  cutRegionsRef.current = cutRegions;
  const speedRegionsRef = useRef(speedRegions);
  speedRegionsRef.current = speedRegions;
  const clipStartRef = useRef(clipStartS);
  clipStartRef.current = clipStartS;
  const clipEndRef = useRef(clipEndS);
  clipEndRef.current = clipEndS;

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

  // Live zoom-keyframe edits (move/trim in the timeline) — this is the fix
  // for the preview never matching what the timeline showed: the renderer
  // used to generate its *own*, independent copy of these keyframes
  // internally and never learned about edits made here. Now `zoomKeyframes`
  // is the single source of truth for both the timeline's visualization
  // and actual playback.
  useEffect(() => {
    if (!loaded) return;
    rendererRef.current?.setZoomKeyframes(zoomKeyframes);
  }, [loaded, zoomKeyframes]);

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
        // Cut regions aren't spliced out of the underlying file (there's
        // no export pipeline to bake that into yet) — instead, playback
        // simply jumps over one the instant it's entered, whether that's
        // from continuous playback reaching it or a seek landing inside
        // it. `duration || video.currentTime` guards the (astronomically
        // unlikely) case where a region's own end is right at the clip's
        // end and floating-point rounding would otherwise land exactly on
        // `duration`, which the video element can react to as "ended".
        const cut = regionAt(cutRegionsRef.current, video.currentTime);
        if (cut) {
          video.currentTime = Math.min(cut.endS, video.duration || video.currentTime);
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

        const speed = regionAt(speedRegionsRef.current, video.currentTime);
        const effectiveRate = playbackRateRef.current * (speed?.rate ?? 1);
        if (Math.abs(video.playbackRate - effectiveRate) > 1e-6) {
          video.playbackRate = effectiveRate;
        }

        const tUs = video.currentTime * 1_000_000 + loaded.meta.videoStartUs;
        renderer.draw(ctx, video, tUs, styleRef.current, showCursorRef.current);
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
    rendererRef.current?.resetAt(clamped * 1_000_000 + loaded.meta.videoStartUs);
    setCurrentTime(clamped);
  }

  /** Writes the amber timeline bar's in/out window (video-relative seconds). */
  function trimVideoClip(startS: number, endS: number) {
    setClipStartS(startS);
    setClipEndS(endS);
  }

  function changeZoomKeyframes(keyframes: ZoomKeyframe[]) {
    setZoomKeyframes(keyframes);
  }

  function cyclePlaybackRate() {
    // Doesn't set `video.playbackRate` directly — the render loop already
    // does that every tick, combining this with any active speed region's
    // multiplier (see `tick`'s `effectiveRate`).
    setPlaybackRate(nextPlaybackRate(playbackRate));
  }

  async function handleDelete() {
    if (!window.confirm("Delete this recording? This can't be undone.")) return;
    await deleteRecording(bundlePath);
    onClose();
  }

  function addCutRegion(region: CutRegion) {
    setCutRegions((regions) => addRegion(regions, region));
  }

  function addSpeedRegion(region: SpeedRegion) {
    setSpeedRegions((regions) => addRegion(regions, region));
  }

  function cycleSpeedRegionRate(id: string) {
    setSpeedRegions((regions) =>
      regions.map((r) => {
        if (r.id !== id) return r;
        const idx = SPEED_REGION_RATES.indexOf(r.rate);
        return { ...r, rate: SPEED_REGION_RATES[(idx + 1) % SPEED_REGION_RATES.length] };
      }),
    );
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
  // Fit the output shape within a max box both ways — a vertical/square
  // aspect needs a height cap too, not just the width cap a landscape
  // recording alone would ever hit.
  let canvasWidth = Math.min(MAX_PREVIEW_WIDTH, loaded.meta.display.widthPx);
  let canvasHeight = Math.round(canvasWidth / outputAspect);
  if (canvasHeight > MAX_PREVIEW_HEIGHT) {
    canvasHeight = MAX_PREVIEW_HEIGHT;
    canvasWidth = Math.round(canvasHeight * outputAspect);
  }

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

      <div className="flex flex-1 items-center justify-center gap-4 overflow-hidden p-6">
        <IconRail />
        <div className="flex h-full flex-1 items-center justify-center">
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            className="max-h-full max-w-full rounded-lg"
          />
        </div>
        <StylePanel style={style} onChange={setStyle} />
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
          onChangeZoomKeyframes={changeZoomKeyframes}
          cutRegions={cutRegions}
          speedRegions={speedRegions}
          onAddCut={addCutRegion}
          onRemoveCut={(id) => setCutRegions((regions) => removeRegion(regions, id))}
          onAddSpeed={addSpeedRegion}
          onRemoveSpeed={(id) => setSpeedRegions((regions) => removeRegion(regions, id))}
          onCycleSpeedRate={cycleSpeedRegionRate}
        />
      </div>
    </div>
  );
}
