import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { loadRecording, type LoadedRecording } from "./api";
import { SceneRenderer } from "./renderer";
import { StylePanel } from "./StylePanel";
import { DEFAULT_STYLE, type StyleSettings } from "./style";

const MAX_PREVIEW_WIDTH = 900;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Post-recording preview: plays `screen.mov` through the same motion
 * engine export will eventually use (ARCHITECTURE.md, "preview and export
 * must never diverge"), with auto-generated zoom/pan that follows the live
 * cursor, an animated cursor overlay, and background/padding/shadow
 * styling. No aspect-ratio switching, trim/cut, or export yet.
 */
export function EditorView({ bundlePath, onClose }: { bundlePath: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState<LoadedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [style, setStyle] = useState<StyleSettings>(DEFAULT_STYLE);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  // Style changes come from slider drags (many events/sec); a ref lets the
  // render loop always read the latest value without restarting the rAF
  // effect on every tick, which `style` as a dependency would cause.
  const styleRef = useRef(style);
  styleRef.current = style;

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
  // "Recording format").
  useEffect(() => {
    if (!loaded) return;
    const { widthPx, heightPx, scaleFactor } = loaded.meta.display;
    rendererRef.current = new SceneRenderer({
      frame: { width: widthPx / scaleFactor, height: heightPx / scaleFactor },
      scaleFactor,
      cursorTrack: loaded.cursorTrack,
    });
    rendererRef.current.resetAt(loaded.meta.videoStartUs);
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
        renderer.draw(ctx, video, tUs, styleRef.current);
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

  const aspect = loaded.meta.display.widthPx / loaded.meta.display.heightPx;
  const canvasWidth = Math.min(MAX_PREVIEW_WIDTH, loaded.meta.display.widthPx);
  const canvasHeight = Math.round(canvasWidth / aspect);

  return (
    <div className="flex h-screen w-screen items-center justify-center gap-6 bg-neutral-950 p-6 text-neutral-300">
      <div className="flex flex-col items-center gap-4">
        <div className="overflow-hidden rounded-lg">
          <canvas ref={canvasRef} width={canvasWidth} height={canvasHeight} className="block" />
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

        <div className="flex w-full items-center gap-3" style={{ maxWidth: canvasWidth }}>
          <button
            type="button"
            onClick={togglePlay}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <span className="w-10 text-right text-xs text-neutral-500">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={currentTime}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="flex-1 accent-neutral-100"
          />
          <span className="w-10 text-xs text-neutral-500">{formatTime(duration)}</span>
          <button type="button" onClick={onClose} className="ml-2 text-xs text-neutral-500 underline">
            Back
          </button>
        </div>
      </div>

      <StylePanel style={style} onChange={setStyle} />
    </div>
  );
}
