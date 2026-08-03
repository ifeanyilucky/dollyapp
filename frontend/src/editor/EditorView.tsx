import { convertFileSrc } from "@tauri-apps/api/core";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { generateZoomKeyframes, splitKeyframeAt, type ZoomKeyframe } from "../motion-engine";
import { aspectRatioPreset } from "./aspect";
import { deleteRecording, loadRecording, revealInFinder, type LoadedRecording } from "./api";
import { playClickSound } from "./clickSound";
import { CursorPanel } from "./CursorPanel";
import { DEFAULT_DOCUMENT, type EditorDocument } from "./document";
import { exportVideo } from "./exportVideo";
import { useHistoryState } from "./history";
import { IconRail, type ToolId } from "./IconRail";
import { SceneRenderer, shiftCursorTrack } from "./renderer";
import { initialSlices, resizeSlices, sliceAt, splitSliceAt, type ClipSlice } from "./slices";
import { SliceEditorPanel } from "./SliceEditorPanel";
import { StylePanel } from "./StylePanel";
import { PreviewControls } from "./PreviewControls";
import { computeOutputSize, resolutionPreset, type ResolutionId } from "./resolution";
import { Timeline } from "./Timeline";
import { nextPlaybackRate, TopBar } from "./TopBar";
import { ZoomEditorPanel } from "./ZoomEditorPanel";

/**
 * Post-recording preview: plays `screen.mov` through the same motion
 * engine export uses (ARCHITECTURE.md, "preview and export must never
 * diverge"), with auto-generated zoom/pan that follows the live cursor,
 * an animated cursor overlay, background/padding/shadow styling, an output
 * aspect ratio switch, and split-based clip slices (speed + per-slice
 * cursor override). "Export" renders the whole clip with every applied
 * setting baked in (zoom keyframes, trim, slices, styling, cursor overlay,
 * aspect) to wherever the user picks in a save dialog.
 *
 * Every one of those settings lives in one `EditorDocument` (see
 * `document.ts`), managed by `useHistoryState` (`history.ts`) rather than a
 * separate `useState` per field — that's what makes Undo/Redo (the top
 * bar's buttons, or ⌘Z/⇧⌘Z) a single linear timeline across all of them
 * instead of an ambiguous "undo *what*?". Playback-only state (current
 * time, playback rate, which panel/slice/keyframe is selected, ...) stays
 * in its own plain `useState`s below — none of it is part of the document,
 * since none of it survives into `exportVideo` and undoing it wouldn't
 * mean anything.
 */
export function EditorView({
  bundlePath,
  onClose,
  onOpenProject,
}: {
  bundlePath: string;
  onClose: () => void;
  /** Switches to a different past recording (folder dropdown's "Show
   * previous projects") — the parent is expected to remount this component
   * (e.g. `key={bundlePath}`) rather than have it hot-swap in place, so
   * every piece of per-recording state below resets cleanly. */
  onOpenProject: (bundlePath: string) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Timeline hover-scrub preview — set while the mouse is over the
  // timeline track, `null` otherwise. Deliberately not part of `currentTime`
  // (the *actual*, committed playhead): hovering should let the canvas show
  // whatever frame is under the cursor without permanently moving playback,
  // so a click can still commit to a *different* spot than the last hover.
  // See `tick` below and `handlePreviewSeek`.
  const [previewTimeS, setPreviewTimeS] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [selectedSliceId, setSelectedSliceId] = useState<string | null>(null);
  const [selectedZoomIndex, setSelectedZoomIndex] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>("style");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  // Layout visibility — the top bar's eye-icon dropdown. Plain UI state,
  // not part of `EditorDocument`: it's not undoable and isn't exported.
  // Independent, persisted-for-the-session toggles (both default visible).
  // "Preview mode" (unrelated to `previewTimeS` above, which is the
  // *timeline hover* preview) is deliberately *not* a third piece of state
  // — it's derived (`previewMode` below) as "both are off," so the eye
  // dropdown's checkboxes are always an honest reflection of what's
  // actually on screen: entering preview mode really does uncheck both,
  // and manually re-checking either one exits preview mode, rather than a
  // separate override flag the checkboxes would otherwise have to be
  // reconciled against.
  const [showSidebar, setShowSidebar] = useState(true);
  const [showTimeline, setShowTimeline] = useState(true);
  const previewMode = !showSidebar && !showTimeline;
  // Whether `PreviewControls` (the floating play/pause bar) is faded in —
  // see the mouse-activity effect below, next to the other preview-mode
  // state. Only meaningful while `previewMode` is true.
  const [previewControlsVisible, setPreviewControlsVisible] = useState(true);

  // The undoable document — style, cursor overlay settings, output aspect,
  // zoom keyframes, clip trim, and slices. See the module doc comment and
  // `history.ts`/`document.ts`.
  const {
    state: doc,
    canUndo,
    canRedo,
    set: setDoc,
    setTransient: setDocTransient,
    commit: commitDoc,
    undo: undoDoc,
    redo: redoDoc,
    patch: patchDoc,
  } = useHistoryState<EditorDocument>(DEFAULT_DOCUMENT);
  const { style, showCursor, aspectRatioId, resolution, zoomKeyframes, clipStartS, clipEndS, slices, cursorSettings } =
    doc;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
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
  // Read from `tick` (see the render-loop effect, keyed only on `loaded`)
  // without becoming a dependency of it — same pattern as the refs above,
  // but this one changes on every mouse-move over the timeline, so it
  // especially can't be a dependency without restarting the rAF loop
  // constantly.
  const previewTimeSRef = useRef(previewTimeS);
  previewTimeSRef.current = previewTimeS;
  // `AudioContext` is created lazily, the first time a click sound is
  // actually needed — browsers want that to happen after a user gesture
  // has occurred somewhere on the page, which is already true by the time
  // playback (itself gesture-triggered) reaches a click event.
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Only sounds for click events strictly after this get played — sourced
  // from `tick`'s own `tUs` each frame and reset on seek, so a scrub never
  // replays every click between the old and new position at once.
  const lastSoundCheckTUsRef = useRef(0);
  // Drive `PreviewControls`' fade — see the mouse-activity effect below.
  const previewHideTimerRef = useRef<number | null>(null);
  const hoveringPreviewControlsRef = useRef(false);

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
          // any window/area recording (non-zero display origin). Applied
          // via `patchDoc` (not `setDoc`) — this is initial data arriving,
          // not a user edit, so it shouldn't be a Redo-able "undo" step.
          const origin = { x: rec.meta.display.originX, y: rec.meta.display.originY };
          const shifted = shiftCursorTrack(rec.cursorTrack, origin);
          patchDoc({ zoomKeyframes: generateZoomKeyframes(shifted, { factor: 1 }) });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [bundlePath, patchDoc]);

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
        // Hover-scrub preview (see `handlePreviewSeek`): moves
        // `video.currentTime` for this frame's render only, without ever
        // touching the committed `currentTime` state below — that's the
        // whole point of the preview/commit split, so hovering can't drag
        // the real playhead along with it. Guarded so a mouse that's just
        // sitting still over the same spot doesn't force a redundant seek
        // every single frame.
        const previewS = previewTimeSRef.current;
        if (previewS !== null && Math.abs(video.currentTime - previewS) > 1e-4) {
          video.currentTime = previewS;
        }

        const activeSlice = sliceAt(slicesRef.current, video.currentTime);

        // A removed slice isn't spliced out of the underlying file (there's
        // no export pipeline to bake that into yet) — instead, playback
        // simply jumps over it the instant it's entered, whether that's
        // from continuous playback reaching it or a seek landing inside
        // it. `duration || video.currentTime` guards the (astronomically
        // unlikely) case where a slice's own end is right at the clip's
        // end and floating-point rounding would otherwise land exactly on
        // `duration`, which the video element can react to as "ended".
        //
        // Skipped entirely while previewing (`previewS !== null`): hovering
        // is just looking, not committing to play through it, and without
        // this guard the jump-to-`endS` here fights the seek-to-`previewS`
        // above every single frame — each undoing the other — as long as
        // the mouse sits still over a removed region, which flickers
        // between the two positions instead of settling on either.
        if (previewS === null && activeSlice?.removed) {
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
        // Skip while previewing — the committed playhead (`currentTime`,
        // and the real solid-white indicator it drives in `Timeline`) must
        // not move just because the mouse is hovering somewhere.
        if (previewS === null) {
          setCurrentTime(video.currentTime);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loaded]);

  // ⌘Z / ⇧⌘Z (or Ctrl on non-Mac) anywhere in the window — the same
  // history the top bar's Undo/Redo buttons drive. Ignored while a text-
  // like input has focus (none exist in these panels today, but this is
  // cheap insurance) and while exporting, matching the top bar buttons'
  // own `disabled` state there. Escape exits preview mode (the eye
  // dropdown's "Enter preview mode") — the top bar stays visible and
  // reachable while previewing, so reopening that same dropdown always
  // works too, but Escape is the faster way out.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (previewMode) togglePreviewMode();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (exporting) return;
      e.preventDefault();
      if (e.shiftKey) {
        if (canRedo) handleRedo();
      } else if (canUndo) {
        handleUndo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo, undoDoc, redoDoc, exporting, previewMode]);

  // Fades `PreviewControls` in on mouse activity and back out after a
  // few seconds of none — only while actually playing; paused, there's no
  // "distraction" to clear away from a static frame, so it stays put (same
  // convention most video players use for their own fullscreen controls).
  // Scoped entirely to `previewMode` — no listener attached, no timer
  // running, the rest of the time.
  useEffect(() => {
    if (!previewMode) return;

    setPreviewControlsVisible(true);

    function scheduleHide() {
      if (previewHideTimerRef.current !== null) window.clearTimeout(previewHideTimerRef.current);
      if (!isPlaying || hoveringPreviewControlsRef.current) return;
      previewHideTimerRef.current = window.setTimeout(() => setPreviewControlsVisible(false), 2500);
    }

    function handleMouseMove() {
      setPreviewControlsVisible(true);
      scheduleHide();
    }

    scheduleHide();
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (previewHideTimerRef.current !== null) window.clearTimeout(previewHideTimerRef.current);
    };
  }, [previewMode, isPlaying]);

  function handlePreviewControlsPointerEnter() {
    hoveringPreviewControlsRef.current = true;
    if (previewHideTimerRef.current !== null) window.clearTimeout(previewHideTimerRef.current);
    setPreviewControlsVisible(true);
  }

  function handlePreviewControlsPointerLeave() {
    hoveringPreviewControlsRef.current = false;
    if (isPlaying) {
      previewHideTimerRef.current = window.setTimeout(() => setPreviewControlsVisible(false), 2500);
    }
  }

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

  /** Hover-scrub preview from `Timeline` (`onPreviewSeek`) — moves the
   * canvas to show whatever frame is under the cursor without committing
   * it as the real, actual playback position. `null` means the mouse left
   * the timeline: revert to showing the actual committed position, as if
   * the hover never happened. See `tick`'s render-loop effect above for
   * the other half of this (it's what actually seeks `video.currentTime`
   * and skips `setCurrentTime` for a previewed frame). */
  function handlePreviewSeek(seconds: number | null) {
    const video = videoRef.current;
    if (!video || isPlaying) return; // don't fight actual playback
    if (seconds === null) {
      setPreviewTimeS(null);
      video.currentTime = currentTime; // snap back to the real committed position
      return;
    }
    setPreviewTimeS(Math.max(clipStartS, Math.min(seconds, clipEndS)));
  }

  /** Live update while dragging either handle of the amber timeline bar —
   * pairs with `commitDoc` (passed to `Timeline` as `onCommitChange`),
   * which turns the whole drag into one undo step on release. */
  function trimVideoClipLive(startS: number, endS: number) {
    setDocTransient((d) => ({ ...d, clipStartS: startS, clipEndS: endS, slices: resizeSlices(d.slices, startS, endS) }));
  }

  function cyclePlaybackRate() {
    // Doesn't set `video.playbackRate` directly — the render loop already
    // does that every tick, combining this with any active slice's speed
    // (see `tick`'s `effectiveRate`). Playback rate is a preview-only
    // convenience (not part of `EditorDocument`, not passed to
    // `exportVideo`), so it isn't undoable.
    setPlaybackRate(nextPlaybackRate(playbackRate));
  }

  async function handleDelete() {
    const confirmed = await confirm("Delete this recording? This can't be undone.", {
      title: "Delete recording",
      kind: "warning",
    });
    if (!confirmed) return;
    await deleteRecording(bundlePath);
    onClose();
  }

  /** Renders the movie with every applied setting baked in — the user picks
   * the destination in a save dialog (see `exportVideo`). */
  async function handleExport() {
    if (!loaded || exporting) return;
    setExporting(true);
    setExportProgress(0);
    try {
      const dest = await exportVideo({
        loaded,
        zoomKeyframes,
        clipStartS,
        clipEndS,
        slices,
        style,
        showCursor,
        cursorSettings,
        aspectRatioId,
        resolution,
        onProgress: (done, total) => setExportProgress(total > 0 ? done / total : 0),
      });
      if (dest) {
        await message(`Saved to:\n${dest}`, { title: "Export complete", kind: "info" });
      }
    } catch (e: unknown) {
      await message(String(e), { title: "Export failed", kind: "error" });
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  function handleSplitClip(atS: number) {
    setDoc((d) => ({ ...d, slices: splitSliceAt(d.slices, atS) }));
  }

  /** `ResolutionPicker`'s `onChange` — rendered from both `Timeline` (next
   * to the split/scissors button) and `PreviewControls` (preview mode
   * hides `Timeline` entirely), so this is one shared handler rather than
   * two copies of the same `setDoc` call. */
  function changeResolution(id: ResolutionId) {
    setDoc((d) => ({ ...d, resolution: id }));
  }

  function handleSplitZoom(index: number, atT: number) {
    setDoc((d) => ({ ...d, zoomKeyframes: splitKeyframeAt(d.zoomKeyframes, index, atT) }));
  }

  function selectSlice(id: string) {
    setSelectedSliceId(id);
    setSelectedZoomIndex(null);
  }

  function selectZoomKeyframe(index: number) {
    setSelectedZoomIndex(index);
    setSelectedSliceId(null);
  }

  /** `IconRail`'s `onSelect` — also clears any selected slice/zoom
   * keyframe, or clicking a rail tool while `SliceEditorPanel`/
   * `ZoomEditorPanel` is showing would silently no-op: the sidebar's
   * ternary checks `selectedSlice`/`selectedZoomKeyframe` before
   * `activeTool`, so without this the panel never actually swaps. */
  function selectTool(id: ToolId) {
    setSelectedSliceId(null);
    setSelectedZoomIndex(null);
    setActiveTool(id);
  }

  /** The eye dropdown's "Enter/Exit preview mode" (and Escape, below) —
   * `previewMode` is derived from `showSidebar`/`showTimeline` rather than
   * its own state (see their declaration), so entering/exiting it just
   * means flipping both at once. */
  function togglePreviewMode() {
    const next = !previewMode;
    setShowSidebar(next);
    setShowTimeline(next);
  }

  function updateSlice(next: ClipSlice) {
    setDoc((d) => ({ ...d, slices: d.slices.map((s) => (s.id === next.id ? next : s)) }));
  }

  function applySpeedToAllSlices() {
    const selected = slices.find((s) => s.id === selectedSliceId);
    if (!selected) return;
    setDoc((d) => ({ ...d, slices: d.slices.map((s) => ({ ...s, speed: selected.speed })) }));
  }

  function removeSlice() {
    if (!selectedSliceId) return;
    setDoc((d) => ({ ...d, slices: d.slices.map((s) => (s.id === selectedSliceId ? { ...s, removed: true } : s)) }));
  }

  /** Live update from `ZoomEditorPanel` — covers *every* field it can
   * change (level, pan mode, instant animation, disabled, snap-to-edges),
   * not just the slider-driven ones: `ZoomEditorPanel` itself calls its own
   * `onCommit` right after this for anything that isn't a slider drag, so
   * a single click still becomes exactly one undo step. */
  function updateZoomKeyframeLive(next: ZoomKeyframe) {
    if (selectedZoomIndex === null) return;
    setDocTransient((d) => ({
      ...d,
      zoomKeyframes: d.zoomKeyframes.map((k, i) => (i === selectedZoomIndex ? next : k)),
    }));
  }

  function applyZoomLevelToAll() {
    if (selectedZoomIndex === null) return;
    const level = zoomKeyframes[selectedZoomIndex].level;
    setDoc((d) => ({ ...d, zoomKeyframes: d.zoomKeyframes.map((k) => ({ ...k, level })) }));
  }

  function removeZoomKeyframe() {
    if (selectedZoomIndex === null) return;
    setDoc((d) => ({ ...d, zoomKeyframes: d.zoomKeyframes.filter((_, i) => i !== selectedZoomIndex) }));
    setSelectedZoomIndex(null);
  }

  /** Live update while dragging a zoom keyframe (move or trim) directly on
   * the timeline — pairs with `commitDoc` (`Timeline`'s `onCommitChange`). */
  function updateAllZoomKeyframesLive(next: ZoomKeyframe[]) {
    setDocTransient((d) => ({ ...d, zoomKeyframes: next }));
  }

  // Undo/redo clear the current slice/zoom-keyframe selection rather than
  // trying to keep it pointed at "the same" item across a change whose
  // array indices/contents it doesn't control — e.g. undoing a removed
  // keyframe restores the array, but there's no principled index to
  // reselect. Showing nothing selected is unambiguous; showing the wrong
  // item selected wouldn't be.
  function handleUndo() {
    setSelectedSliceId(null);
    setSelectedZoomIndex(null);
    undoDoc();
  }

  function handleRedo() {
    setSelectedSliceId(null);
    setSelectedZoomIndex(null);
    redoDoc();
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
  // The canvas element's `width`/`height` *attributes* (as opposed to its
  // CSS size, set separately below) are its actual render resolution — the
  // same `computeOutputSize` calculation `exportVideo` uses, so what the
  // preview renders at is genuinely what gets exported, not a separate
  // on-screen-box-driven guess (ARCHITECTURE.md, "preview and export must
  // never diverge"). The CSS `max-h-full max-w-full` below then scales
  // that pixel buffer down to fit whatever on-screen space is actually
  // available, exactly like an `<img>` would — the browser downsamples for
  // display without touching the underlying render resolution.
  const { width: canvasWidth, height: canvasHeight } = computeOutputSize(
    resolutionPreset(resolution).longEdge,
    loaded.meta.display.widthPx,
    loaded.meta.display.heightPx,
    outputAspect,
  );

  const selectedSlice = slices.find((s) => s.id === selectedSliceId);
  const selectedZoomKeyframe = selectedZoomIndex !== null ? zoomKeyframes[selectedZoomIndex] : undefined;

  return (
    <div className="relative flex h-screen w-screen flex-col bg-neutral-950 text-neutral-300">
      <TopBar
        title={bundlePath.split("/").pop() ?? bundlePath}
        aspectRatioId={aspectRatioId}
        onChangeAspectRatio={(id) => setDoc((d) => ({ ...d, aspectRatioId: id }))}
        showSidebar={showSidebar}
        onToggleSidebar={() => setShowSidebar((v) => !v)}
        showTimeline={showTimeline}
        onToggleTimeline={() => setShowTimeline((v) => !v)}
        previewMode={previewMode}
        onTogglePreviewMode={togglePreviewMode}
        playbackRate={playbackRate}
        onCyclePlaybackRate={cyclePlaybackRate}
        onExport={() => void handleExport()}
        exporting={exporting}
        exportProgress={exportProgress}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onRevealInFinder={() => void revealInFinder(bundlePath)}
        onOpenProject={onOpenProject}
        onDelete={() => void handleDelete()}
        onClose={onClose}
      />

      {/* `min-h-0` on this row and `min-w-0`/`min-h-0` on the canvas well
       * below override flexbox's default `min-width/height: auto`, which
       * otherwise floors a flex item at its content's intrinsic size —
       * without it, shrinking the window doesn't shrink the canvas, it
       * just gets silently clipped by `overflow-hidden` instead. */}
      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-4 overflow-hidden p-6">
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
          {/* Click to play/pause — the only way to control playback while
           * the timeline (which normally owns the play button) is hidden,
           * whether that's preview mode or just "Show editor timeline"
           * unchecked. Harmless as a global affordance either way. */}
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            onClick={togglePlay}
            className="max-h-full max-w-full cursor-pointer rounded-lg"
            title={isPlaying ? "Pause" : "Play"}
          />
        </div>
        {showSidebar && (
          <>
            <IconRail active={selectedSlice || selectedZoomKeyframe ? null : activeTool} onSelect={selectTool} />
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
                onChange={updateZoomKeyframeLive}
                onCommit={commitDoc}
                onApplyLevelToAll={applyZoomLevelToAll}
                onRemove={removeZoomKeyframe}
                onClose={() => setSelectedZoomIndex(null)}
              />
            ) : activeTool === "cursor" ? (
              <CursorPanel
                settings={cursorSettings}
                onChange={(next) => setDocTransient((d) => ({ ...d, cursorSettings: next }))}
                onCommit={commitDoc}
                showCursor={showCursor}
                onToggleShowCursor={() => setDoc((d) => ({ ...d, showCursor: !d.showCursor }))}
              />
            ) : (
              <StylePanel
                style={style}
                onChange={(next) => setDocTransient((d) => ({ ...d, style: next }))}
                onCommit={commitDoc}
              />
            )}
          </>
        )}
      </div>

      {previewMode && (
        <PreviewControls
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          clipStartS={clipStartS}
          clipEndS={clipEndS}
          onTogglePlay={togglePlay}
          onSeek={handleSeek}
          visible={previewControlsVisible}
          onPointerEnter={handlePreviewControlsPointerEnter}
          onPointerLeave={handlePreviewControlsPointerLeave}
          resolution={resolution}
          onChangeResolution={changeResolution}
          sourceWidthPx={loaded.meta.display.widthPx}
          sourceHeightPx={loaded.meta.display.heightPx}
        />
      )}

      {/* Hidden — used purely as a decoded-frame source for the canvas. */}
      <video
        ref={videoRef}
        src={convertFileSrc(loaded.screenVideoPath)}
        className="hidden"
        preload="auto"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setDuration(d);
          // Initial data, not a user edit — see `patchDoc`'s doc comment
          // on the bundle-load effect above.
          patchDoc({ clipStartS: 0, clipEndS: d, slices: initialSlices(0, d) });
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {showTimeline && (
        <div className="px-6 pb-6">
          <Timeline
            duration={duration}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onTogglePlay={togglePlay}
            onSeek={handleSeek}
            onPreviewSeek={handlePreviewSeek}
            zoomKeyframes={zoomKeyframes}
            videoStartUs={loaded.meta.videoStartUs}
            clipStartS={clipStartS}
            clipEndS={clipEndS}
            onTrimVideoClip={trimVideoClipLive}
            onChangeZoomKeyframes={updateAllZoomKeyframesLive}
            onCommitChange={commitDoc}
            slices={slices}
            onSplitClip={handleSplitClip}
            onSelectSlice={selectSlice}
            onSplitZoomKeyframe={handleSplitZoom}
            onSelectZoomKeyframe={selectZoomKeyframe}
            resolution={resolution}
            onChangeResolution={changeResolution}
            sourceWidthPx={loaded.meta.display.widthPx}
            sourceHeightPx={loaded.meta.display.heightPx}
          />
        </div>
      )}
    </div>
  );
}
