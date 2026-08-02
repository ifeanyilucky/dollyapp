import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { generateZoomKeyframes } from "../motion-engine";
import { aspectRatioPreset, type AspectRatioId } from "./aspect";
import { deleteRecording, loadRecording, revealInFinder, type LoadedRecording } from "./api";
import { IconRail } from "./IconRail";
import { SceneRenderer } from "./renderer";
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
 * and an output aspect ratio switch. No trim/cut/speed-ramping or true
 * export (motion baked into an output file) yet.
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  // Style/cursor-visibility changes can fire rapidly (slider drags) or
  // need to be read from a rAF loop that shouldn't restart every tick —
  // refs let `tick` always see the latest value without becoming a
  // dependency of the render-loop effect.
  const styleRef = useRef(style);
  styleRef.current = style;
  const showCursorRef = useRef(showCursor);
  showCursorRef.current = showCursor;

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    loadRecording(bundlePath)
      .then((rec) => {
        if (!cancelled) setLoaded(rec);
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
  // "Recording format"). Deliberately *not* keyed on `aspectRatioId` —
  // switching it later goes through `renderer.setOutputAspect` instead
  // (see the effect below), so it reshapes in place rather than
  // recreating the renderer and resetting playback.
  useEffect(() => {
    if (!loaded) return;
    const { widthPx, heightPx, scaleFactor, originX, originY } = loaded.meta.display;
    rendererRef.current = new SceneRenderer({
      frame: { width: widthPx / scaleFactor, height: heightPx / scaleFactor },
      scaleFactor,
      cursorTrack: loaded.cursorTrack,
      origin: { x: originX, y: originY },
      outputAspect: aspectRatioPreset(aspectRatioId).ratio ?? undefined,
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

  // Same keyframes SceneRenderer generates internally, recomputed here
  // purely for the timeline's zoom-track visualization — cheap pure
  // function, not worth threading a getter through SceneRenderer for.
  const zoomKeyframes = useMemo(() => {
    if (!loaded) return [];
    return generateZoomKeyframes(loaded.cursorTrack, { factor: 1 });
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
    if (video.paused) void video.play();
    else video.pause();
  }

  function handleSeek(seconds: number) {
    const video = videoRef.current;
    if (!video || !loaded) return;
    video.currentTime = seconds;
    rendererRef.current?.resetAt(seconds * 1_000_000 + loaded.meta.videoStartUs);
    setCurrentTime(seconds);
  }

  function cyclePlaybackRate() {
    const next = nextPlaybackRate(playbackRate);
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }

  async function handleDelete() {
    if (!window.confirm("Delete this recording? This can't be undone.")) return;
    await deleteRecording(bundlePath);
    onClose();
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
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
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
        />
      </div>
    </div>
  );
}
