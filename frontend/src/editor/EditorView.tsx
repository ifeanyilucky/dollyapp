import { confirm, message } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { generateZoomKeyframes, splitKeyframeAt, type ZoomKeyframe } from "../motion-engine";
import { AnimationPanel } from "./AnimationPanel";
import { aspectRatioPreset } from "./aspect";
import { deleteRecording, loadRecording, mediaSrc, revealInFinder, type LoadedRecording } from "./api";
import { AudioPanel } from "./AudioPanel";
import { BackgroundAudioPlayer, decodeAudioFromUrl, getAmbientBuffer, isAmbientTrackId } from "./backgroundAudio";
import { playClickSound } from "./clickSound";
import { CropFooter, CropOverlay, CropToolbar } from "./CropEditor";
import { clampCropRect, fullFrameCrop, isFullFrameCrop, type CropRect } from "./crop";
import { CursorPanel } from "./CursorPanel";
import { DEFAULT_DOCUMENT, type EditorDocument } from "./document";
import { exportVideo } from "./exportVideo";
import { useHistoryState } from "./history";
import { IconRail, type ToolId } from "./IconRail";
import { MaskOverlay } from "./MaskEditor";
import { createMask, defaultMaskRange, defaultMaskRect, masksActiveAt, type MaskClip, type MaskType } from "./masks";
import { MaskEditorPanel } from "./MaskEditorPanel";
import { NarrationPlayer } from "./narration";
import { computeContentRect, SceneRenderer, shiftCursorTrack } from "./renderer";
import { initialSlices, resizeSlices, sliceAt, splitSliceAt, type ClipSlice } from "./slices";
import { SliceEditorPanel } from "./SliceEditorPanel";
import { StylePanel } from "./StylePanel";
import { PreviewControls } from "./PreviewControls";
import { computeOutputSize, resolutionPreset, type ResolutionId } from "./resolution";
import { Timeline } from "./Timeline";
import { nextPlaybackRate, TopBar } from "./TopBar";
import { ZoomEditorPanel } from "./ZoomEditorPanel";

/** Arrow-key playback nudge (no per-recording frame rate is tracked, so
 * this is a reasonable fixed approximation rather than a true single-frame
 * step) — Shift jumps a full second instead, for covering more ground
 * quickly. */
const FRAME_STEP_S = 1 / 30;

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
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
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
  // Crop mode (the top bar's "Crop" button) — `cropMode` toggles the
  // `CropEditor` overlay on; `draftCrop` is the *in-progress* rect it edits
  // (drag handles, Size/Position inputs), kept as plain local state rather
  // than routed through `doc.crop` until "Confirm changes" commits it as
  // one `history.set` — see `enterCropMode`/`confirmCrop`/`discardCrop`.
  // While `cropMode` is true the canvas keeps showing the *full,
  // uncropped* frame (see `tick` below) regardless of `doc.crop`, so the
  // user can see context around the boundary while dragging; only a
  // confirmed `doc.crop` ever actually crops what's rendered/exported.
  const [cropMode, setCropMode] = useState(false);
  const [draftCrop, setDraftCrop] = useState<CropRect | null>(null);

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
  const {
    style,
    showCursor,
    aspectRatioId,
    resolution,
    crop,
    zoomKeyframes,
    clipStartS,
    clipEndS,
    slices,
    cursorSettings,
    masks,
    animationSettings,
    audioSettings,
  } = doc;

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
  const masksRef = useRef(masks);
  masksRef.current = masks;
  const clipStartRef = useRef(clipStartS);
  clipStartRef.current = clipStartS;
  const clipEndRef = useRef(clipEndS);
  clipEndRef.current = clipEndS;
  const cursorSettingsRef = useRef(cursorSettings);
  cursorSettingsRef.current = cursorSettings;
  const animationSettingsRef = useRef(animationSettings);
  animationSettingsRef.current = animationSettings;
  // Read once, at mount, by the background-audio-player-creation effect
  // below — not a per-frame `tick` dependency the way the other refs here
  // are, but the same "read latest without retriggering an effect" need.
  const audioSettingsRef = useRef(audioSettings);
  audioSettingsRef.current = audioSettings;
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
  // The Audio panel's background track player — created once (see the
  // mount effect below), reused across every track/volume/mute change and
  // every play/pause. Lives alongside `audioCtxRef` rather than replacing
  // its own click-sound usage; both share the same `AudioContext`.
  const bgAudioPlayerRef = useRef<BackgroundAudioPlayer | null>(null);
  // Mic narration playback (see `narration.ts`) — same lifecycle as
  // `bgAudioPlayerRef` (created once, alongside it), but a separate player
  // since narration is a single non-looping, seekable track rather than an
  // always-looping ambient one.
  const narrationPlayerRef = useRef<NarrationPlayer | null>(null);
  // Drive `PreviewControls`' fade — see the mouse-activity effect below.
  const previewHideTimerRef = useRef<number | null>(null);
  const hoveringPreviewControlsRef = useRef(false);
  // Read from `tick` without becoming a dependency of it — same pattern as
  // `styleRef`/etc above; `tick` passes this straight through to
  // `renderer.draw()`'s `forceFullFrame` (see its doc comment).
  const cropModeRef = useRef(cropMode);
  cropModeRef.current = cropMode;
  // Read from `tick` without becoming a dependency of it — same pattern as
  // the refs above.
  const selectedMaskIdRef = useRef(selectedMaskId);
  selectedMaskIdRef.current = selectedMaskId;
  // Whether the selected mask is actually *in range* right now (current
  // time within its own `[startS, endS)`) — mirrored from `maskPreviewActive`,
  // computed further down (once `loaded`/`masks` exist) — see that
  // constant's own doc comment for what this drives in `tick`.
  const maskPreviewActiveRef = useRef(false);
  // Whether a handle on the selected mask's `MaskOverlay` box is currently
  // being dragged — set via `MaskOverlay`'s `onDraggingChange`. `tick` uses
  // this (together with `maskPreviewActiveRef`) to briefly swap a
  // *"sensitive"* mask's real, rendered blur out for raw content while a
  // handle is actually held down, so its box can be lined up against
  // picture that isn't already blurred out from under it — see
  // `MaskEditor.tsx`'s module doc comment. Not applied to "highlight"
  // masks (see `selectedMaskTypeRef`): dimming the *outside* never
  // obscures anything inside the box you're actually resizing, so there's
  // nothing to peek past — suppressing it too just made the live dim
  // preview flicker off for the entire drag.
  const maskDraggingRef = useRef(false);
  // Mirrors `selectedMask?.type` — see `maskDraggingRef`'s doc comment for
  // why `tick` needs to know this.
  const selectedMaskTypeRef = useRef<MaskType | null>(null);
  // Whichever element(s) a click should *not* count as "outside the mask"
  // for `MaskOverlay`'s click-to-deselect handling — currently just the
  // sidebar column (`IconRail` + whichever panel is open), so interacting
  // with `MaskEditorPanel`'s own controls doesn't itself end the editing
  // session. See the `showSidebar &&` block's wrapper `<div>` below.
  const sidebarRef = useRef<HTMLDivElement>(null);
  // The recording's own point-space dimensions (independent of crop,
  // resolution, or aspect ratio) — the coordinate space `doc.crop`/
  // `draftCrop` live in (see `crop.ts`). Set once `loaded` (where it's
  // computed, alongside `canvasWidth`/`canvasHeight` below) is truthy —
  // read by the keyboard-nudge effect, which (like every `useEffect` call,
  // per the Rules of Hooks) has to sit before this component's `!loaded`
  // early return, where that value doesn't exist yet.
  const sourceFrameSizeRef = useRef({ width: 0, height: 0 });

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

  // While actively re-editing a crop, the renderer needs the *un*cropped
  // recording — `CropOverlay` draws its handles/dimming against the whole
  // selectable area, not whatever the currently-confirmed crop already
  // narrowed things down to (see `CropEditor.tsx`'s doc comment). Once
  // confirmed (or if there was never a crop to begin with), this is just
  // `crop` itself.
  const effectiveCrop = cropMode ? null : crop;

  // Build the renderer once the bundle's loaded — cursor coordinates are
  // in point space, so the motion engine gets point-space frame
  // dimensions, not the video's actual pixel dimensions (ARCHITECTURE.md,
  // "Recording format"). Deliberately *not* keyed on `aspectRatioId` or
  // `zoomKeyframes` — switching/editing those later goes through
  // `renderer.setOutputAspect`/`setZoomKeyframes` instead (see the effects
  // below), so they apply in place rather than recreating the renderer
  // and resetting playback. `effectiveCrop` *is* in the dependency list,
  // though (entering/exiting/confirming a crop is rare and deliberate, not
  // a live drag — a full rebuild is simplest and correct here): a crop
  // redefines what "the whole recording" even *is* for the motion engine
  // (see `SceneRendererOptions.crop`), which isn't something `SceneRenderer`
  // exposes a live setter for the way it does for aspect/keyframes.
  useEffect(() => {
    if (!loaded) return;
    const { widthPx, heightPx, scaleFactor, originX, originY } = loaded.meta.display;
    rendererRef.current = new SceneRenderer({
      frame: { width: widthPx / scaleFactor, height: heightPx / scaleFactor },
      scaleFactor,
      cursorTrack: loaded.cursorTrack,
      origin: { x: originX, y: originY },
      crop: effectiveCrop,
      outputAspect: aspectRatioPreset(aspectRatioId).ratio ?? undefined,
      zoomKeyframes,
      screenAnimationStyle: animationSettingsRef.current.screenAnimationStyle,
      cursorAnimationStyle: animationSettingsRef.current.cursorAnimationStyle,
    });
    // Resumes from wherever playback currently is rather than always the
    // very start — on the very first build (mount), `videoRef.current` is
    // still null/at 0 either way, so this is a no-op difference there;
    // it only matters for a *later* rebuild (a crop confirm/discard/entry
    // mid-playback), where jumping back to the start would be jarring.
    const resumeAtS = videoRef.current?.currentTime ?? 0;
    rendererRef.current.resetAt(resumeAtS * 1_000_000 + loaded.meta.videoStartUs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, effectiveCrop]);

  // Live aspect-ratio switch — reshapes the existing renderer's viewport
  // instead of rebuilding it (see the effect above).
  useEffect(() => {
    if (!loaded) return;
    rendererRef.current?.setOutputAspect(aspectRatioPreset(aspectRatioId).ratio ?? undefined);
  }, [loaded, aspectRatioId]);

  // Live "Screen animation style"/"Cursor animation style" switch (the
  // Animations panel) — reshapes the renderer's existing spring/filter
  // state in place rather than rebuilding it, same as the aspect-ratio
  // effect above. `motionBlur`/the "applies to" toggles don't need an
  // effect at all — they're plain per-frame multipliers read straight out
  // of `animationSettingsRef` in `tick`'s `renderer.draw()` call below.
  useEffect(() => {
    if (!loaded) return;
    rendererRef.current?.setScreenAnimationStyle(animationSettings.screenAnimationStyle);
  }, [loaded, animationSettings.screenAnimationStyle]);

  useEffect(() => {
    if (!loaded) return;
    rendererRef.current?.setCursorAnimationStyle(animationSettings.cursorAnimationStyle);
  }, [loaded, animationSettings.cursorAnimationStyle]);

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

  // Creates the Audio panel's background track player once, up front —
  // unlike the click-sound `AudioContext` above, this one isn't deferred
  // until first use: selecting a track while paused should already have it
  // ready to play the instant playback starts, not decode on the first
  // `isPlaying` flip. Constructing an `AudioContext` itself needs no user
  // gesture (only actually producing sound does, which `play()` already
  // gates on `ctx.state`), so this is safe at mount.
  useEffect(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    const player = new BackgroundAudioPlayer(ctx, ctx.destination);
    player.setVolume(audioSettingsRef.current.volume, audioSettingsRef.current.muted);
    bgAudioPlayerRef.current = player;
    const narrationPlayer = new NarrationPlayer(ctx, ctx.destination);
    narrationPlayer.setVolume(audioSettingsRef.current.micVolume, audioSettingsRef.current.micMuted);
    narrationPlayerRef.current = narrationPlayer;
    return () => {
      player.dispose();
      bgAudioPlayerRef.current = null;
      narrationPlayer.dispose();
      narrationPlayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decodes the recording's own mic track (if it has one) once `loaded`
  // arrives — a fixed, whole-file buffer, unlike the background track
  // above which can change any time the user picks a different one.
  useEffect(() => {
    if (!loaded || !loaded.meta.hasMicAudio) return;
    const ctx = audioCtxRef.current;
    const player = narrationPlayerRef.current;
    if (!ctx || !player) return;
    let cancelled = false;
    void decodeAudioFromUrl(ctx, mediaSrc(loaded.micAudioUrl)).then((buffer) => {
      if (!cancelled) player.setBuffer(buffer);
    });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  useEffect(() => {
    narrationPlayerRef.current?.setVolume(audioSettings.micVolume, audioSettings.micMuted);
  }, [audioSettings.micVolume, audioSettings.micMuted]);

  // Resolves whichever track `audioSettings.trackId` points at (a built-in
  // ambient preset, or the user's uploaded file) into a real `AudioBuffer`
  // and hands it to the player — `BackgroundAudioPlayer.setBuffer` swaps
  // the loop source live, including mid-playback, without touching play
  // state. `null` (no track/"Remove background audio") just silences it.
  useEffect(() => {
    const player = bgAudioPlayerRef.current;
    const ctx = audioCtxRef.current;
    if (!player || !ctx) return;
    let cancelled = false;
    async function resolveTrack() {
      if (!audioSettings.trackId) {
        player!.setBuffer(null);
        return;
      }
      const buffer = isAmbientTrackId(audioSettings.trackId)
        ? await getAmbientBuffer(audioSettings.trackId)
        : audioSettings.customAudioUrl
          ? await decodeAudioFromUrl(ctx!, audioSettings.customAudioUrl)
          : null;
      if (!cancelled) player!.setBuffer(buffer);
    }
    void resolveTrack();
    return () => {
      cancelled = true;
    };
  }, [audioSettings.trackId, audioSettings.customAudioUrl]);

  // Volume/mute are plain gain-node values — no async resolution needed,
  // unlike the track itself above.
  useEffect(() => {
    bgAudioPlayerRef.current?.setVolume(audioSettings.volume, audioSettings.muted);
  }, [audioSettings.volume, audioSettings.muted]);

  // Background audio mirrors the main video's own play state, exactly like
  // a real embedded audio track would — it doesn't need to track seeks/
  // scrubs/removed-slice jumps the way the video and cursor do, since it's
  // a decorative ambient loop rather than something synced to specific
  // recorded moments. Narration, unlike the ambient loop, *does* need to
  // start from wherever the video actually is (`playFrom`, not a plain
  // `play`) — see `handleSeek` and `tick`'s per-frame `resyncIfDrifted`
  // call for how it stays there afterward.
  useEffect(() => {
    if (isPlaying) {
      bgAudioPlayerRef.current?.play();
      narrationPlayerRef.current?.playFrom(videoRef.current?.currentTime ?? 0);
    } else {
      bgAudioPlayerRef.current?.pause();
      narrationPlayerRef.current?.pause();
    }
  }, [isPlaying]);

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

        // Keeps narration lined up with `video.currentTime` over a long
        // playback — a no-op whenever it's already close enough (see
        // `NarrationPlayer.resyncIfDrifted`'s own threshold) or paused.
        narrationPlayerRef.current?.resyncIfDrifted(video.currentTime);

        // `maskEditingActive`: the selected mask's box (`MaskOverlay`) is
        // actually showing right now — selected *and* currently in its own
        // `[startS, endS)` range (see `maskPreviewActiveRef`'s doc comment;
        // this is `EditorView`'s fix for the box/effect not respecting the
        // mask's own time range). While it is, `forceFullFrame` holds the
        // same full, unzoomed frame crop mode does — so the box can be
        // positioned against a stable view instead of fighting an in-
        // progress zoom/pan — same as `cropModeRef`, below.
        const maskEditingActive = maskPreviewActiveRef.current;
        // Only while a handle on that box is actually being *held down*
        // (`maskDraggingRef`, set by `MaskOverlay`'s `onDraggingChange`),
        // and only for a "sensitive" (blur) mask specifically — see
        // `maskDraggingRef`'s doc comment for why "highlight" is excluded
        // — is the mask's own real effect swapped out for raw content. The
        // rest of the time the canvas shows the mask's genuine rendered
        // effect, so this always stays What-You-See-Is-What-You-Export
        // rather than a separate, easily-out-of-sync approximation (the
        // previous version's actual bug: `MaskOverlay` used to paint its
        // own fixed-alpha dim/blur preview that ignored the mask's real
        // `opacity` and `disabled`).
        const suppressSelectedMaskRender =
          maskEditingActive && maskDraggingRef.current && selectedMaskTypeRef.current === "sensitive";
        renderer.draw(
          ctx,
          video,
          tUs,
          styleRef.current,
          showCursorRef.current,
          cursorSettingsRef.current,
          clipEndTUs,
          activeSlice?.cursorOverride ?? null,
          cropModeRef.current || maskEditingActive,
          masksActiveAt(masksRef.current, video.currentTime).filter(
            (m) => !(suppressSelectedMaskRender && m.id === selectedMaskIdRef.current),
          ),
          maskEditingActive ? selectedMaskIdRef.current : null,
          animationSettingsRef.current,
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

  // The editor's global keyboard shortcuts — everything here is ignored
  // while a text-like input has focus (cheap insurance; none of these
  // panels have one today) and while actively cropping, since `CropEditor`
  // owns arrow keys for nudging the crop rect via its own effect below and
  // Space/Delete/seek-arrows would all be meaningless mid-crop anyway:
  //
  //  - Escape exits preview mode (the eye dropdown's "Enter preview mode")
  //    — the top bar stays visible/reachable while previewing, so
  //    reopening that dropdown always works too, but this is the faster
  //    way out.
  //  - ⌘Z / ⇧⌘Z (or Ctrl on non-Mac) is Undo/Redo, the same history the
  //    top bar's buttons drive — also guarded on `exporting`, matching
  //    those buttons' own `disabled` state.
  //  - Space toggles play/pause, same as clicking the canvas or the
  //    Timeline's play button — standard across every video editor/player.
  //  - Left/Right arrow nudges the playhead by `FRAME_STEP_S` (Shift: a
  //    full second) — frame-accurate stepping without needing to grab the
  //    (possibly tiny, at low zoom) timeline with a mouse.
  //  - Delete/Backspace removes whichever of a slice/zoom keyframe/mask is
  //    currently selected, if any — same effect as that panel's own
  //    "Remove" button, just reachable without moving the mouse there.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (previewMode) togglePreviewMode();
        return;
      }

      const target = e.target as HTMLElement | null;
      const inInput = target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (inInput || exporting) return;
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) handleRedo();
        } else if (canUndo) {
          handleUndo();
        }
        return;
      }

      if (cropMode || inInput) return;

      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        const step = e.shiftKey ? 1 : FRAME_STEP_S;
        handleSeek(video.currentTime + (e.key === "ArrowLeft" ? -step : step));
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedSliceId) {
          if (slices.filter((s) => !s.removed).length > 1) removeSlice();
        } else if (selectedZoomIndex !== null) {
          removeZoomKeyframe();
        } else if (selectedMaskId) {
          removeMask();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo, undoDoc, redoDoc, exporting, previewMode, cropMode, selectedSliceId, selectedZoomIndex, selectedMaskId, slices]);

  // Arrow-key nudge for the crop rect while `CropEditor` is open (see the
  // `Keyboard` icon in `CropToolbar`) — 1px per press, 10px with Shift.
  // Ignored while a number input has focus, so the Size/Position fields'
  // own native up/down arrow behavior isn't fought over. Reads
  // `sourceFrameSizeRef` (not a plain const computed further down, after
  // this component's `!loaded` early return) since this effect — like
  // every other `useEffect` call, per the Rules of Hooks — has to sit
  // before any conditional return, where that value doesn't exist yet.
  useEffect(() => {
    if (!cropMode || !draftCrop) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!draftCrop) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const step = e.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;
      e.preventDefault();
      const source = sourceFrameSizeRef.current;
      setDraftCrop(
        clampCropRect({ ...draftCrop, x: draftCrop.x + dx, y: draftCrop.y + dy }, source.width, source.height),
      );
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cropMode, draftCrop]);

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
      // WKWebView (this app's webview on macOS) only allows
      // `AudioContext.resume()` to actually take effect when it's called
      // synchronously inside a real user-gesture handler — calling it from
      // an async callback or a `requestAnimationFrame` loop (even one
      // triggered moments after a click) silently no-ops there, which is
      // why background audio/click sounds need this *here*, not inside the
      // `isPlaying` effect or `tick`'s rAF loop that actually start/stop
      // them. Every play control (Space, canvas click, Timeline/
      // PreviewControls buttons) funnels through this one function, so one
      // resume call here covers all of them.
      if (audioCtxRef.current?.state === "suspended") void audioCtxRef.current.resume();
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
    // Keep narration lined up with a seek that happens mid-playback (e.g.
    // clicking elsewhere on the timeline while playing) — a no-op while
    // paused, since the `isPlaying` effect above already starts it from the
    // right offset on the next play.
    if (isPlaying) narrationPlayerRef.current?.playFrom(clamped);
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
        masks,
        style,
        showCursor,
        cursorSettings,
        animationSettings,
        audioSettings,
        aspectRatioId,
        resolution,
        crop,
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
    setSelectedMaskId(null);
  }

  function selectZoomKeyframe(index: number) {
    setSelectedZoomIndex(index);
    setSelectedSliceId(null);
    setSelectedMaskId(null);
  }

  function selectMask(id: string) {
    setSelectedMaskId(id);
    setSelectedSliceId(null);
    setSelectedZoomIndex(null);
  }

  /** `IconRail`'s `onSelect` — also clears any selected slice/zoom
   * keyframe/mask, or clicking a rail tool while `SliceEditorPanel`/
   * `ZoomEditorPanel`/`MaskEditorPanel` is showing would silently no-op:
   * the sidebar's ternary checks `selectedSlice`/`selectedZoomKeyframe`/
   * `selectedMask` before `activeTool`, so without this the panel never
   * actually swaps. */
  function selectTool(id: ToolId) {
    setSelectedSliceId(null);
    setSelectedZoomIndex(null);
    setSelectedMaskId(null);
    setActiveTool(id);
  }

  /** The eye dropdown's "Enter/Exit preview mode" (and Escape, below) —
   * `previewMode` is derived from `showSidebar`/`showTimeline` rather than
   * its own state (see their declaration), so entering/exiting it just
   * means flipping both at once. */
  function togglePreviewMode() {
    // Currently in preview mode (both hidden) -> show both again; not in
    // preview mode (at least one visible) -> hide both. That's `previewMode`
    // itself as the target visibility, not its negation.
    setShowSidebar(previewMode);
    setShowTimeline(previewMode);
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

  /** The top bar's "Mask" dropdown — adds a new mask starting at the
   * current playhead (`defaultMaskRange`, `DEFAULT_MASK_DURATION_S` long,
   * clamped to the clip), a centered box sized off the *effective* frame
   * (`defaultMaskRect` — see `effectiveFrameSize`'s doc comment), and
   * immediately selects it, opening `MaskEditorPanel` (and `MaskOverlay`
   * on the canvas, for repositioning/resizing the box) the same way
   * clicking a freshly-split slice would. */
  function addMask(type: MaskType) {
    const { startS, endS } = defaultMaskRange(currentTime, clipStartS, clipEndS);
    const rect = defaultMaskRect(effectiveFrameSize.width, effectiveFrameSize.height);
    const mask = createMask(startS, endS, type, rect);
    setDoc((d) => ({ ...d, masks: [...d.masks, mask] }));
    setSelectedMaskId(mask.id);
    setSelectedSliceId(null);
    setSelectedZoomIndex(null);
  }

  function updateMask(next: MaskClip) {
    setDoc((d) => ({ ...d, masks: d.masks.map((m) => (m.id === next.id ? next : m)) }));
  }

  /** `MaskOverlay`'s live update while dragging the selected mask's box —
   * pairs with `commitDoc` on release, same as every other drag-driven
   * edit. */
  function updateMaskRectLive(next: CropRect) {
    if (!selectedMaskId) return;
    setDocTransient((d) => ({
      ...d,
      masks: d.masks.map((m) => (m.id === selectedMaskId ? { ...m, rect: next } : m)),
    }));
  }

  /** Unlike `removeSlice` (which marks `removed: true` to preserve the
   * "slices always tile the clip" invariant), a mask is an independent
   * overlay with no such invariant to protect — removing it outright is
   * safe and simpler. */
  function removeMask() {
    if (!selectedMaskId) return;
    setDoc((d) => ({ ...d, masks: d.masks.filter((m) => m.id !== selectedMaskId) }));
    setSelectedMaskId(null);
  }

  /** Live update while dragging a mask clip (move or trim) directly on the
   * timeline — pairs with `commitDoc` (`Timeline`'s `onCommitChange`), same
   * as `updateAllZoomKeyframesLive`. */
  function updateAllMasksLive(next: MaskClip[]) {
    setDocTransient((d) => ({ ...d, masks: next }));
  }

  // Undo/redo clear the current slice/zoom-keyframe/mask selection rather
  // than trying to keep it pointed at "the same" item across a change whose
  // array indices/contents it doesn't control — e.g. undoing a removed
  // keyframe restores the array, but there's no principled index to
  // reselect. Showing nothing selected is unambiguous; showing the wrong
  // item selected wouldn't be.
  function handleUndo() {
    setSelectedSliceId(null);
    setSelectedZoomIndex(null);
    setSelectedMaskId(null);
    undoDoc();
  }

  function handleRedo() {
    setSelectedSliceId(null);
    setSelectedZoomIndex(null);
    setSelectedMaskId(null);
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

  // The recording's own point-space dimensions — same units as
  // `frame`/`origin` passed to `SceneRenderer`, and what `doc.crop`/
  // `draftCrop` coordinates are in (see `crop.ts`). Independent of crop,
  // resolution, or aspect ratio: it's the fixed space crop *selects
  // within*, not the (crop-affected) output.
  const sourceFrameSize = {
    width: loaded.meta.display.widthPx / loaded.meta.display.scaleFactor,
    height: loaded.meta.display.heightPx / loaded.meta.display.scaleFactor,
  };
  sourceFrameSizeRef.current = sourceFrameSize;

  // The *effective* frame — the confirmed crop's own size once one exists,
  // `sourceFrameSize` otherwise. `MaskClip.rect` lives in this space (see
  // its doc comment): a mask is positioned relative to "the recording as
  // it's actually being edited," which is the cropped view once a crop is
  // confirmed, the same way zoom keyframes and the cursor overlay are
  // already re-anchored to it internally by `SceneRenderer`.
  const effectiveFrameSize = crop ? { width: crop.width, height: crop.height } : sourceFrameSize;

  const sourceAspect = loaded.meta.display.widthPx / loaded.meta.display.heightPx;
  const outputAspect = aspectRatioPreset(aspectRatioId).ratio ?? sourceAspect;
  // The canvas element's `width`/`height` *attributes* (as opposed to its
  // CSS size, set separately below) are its actual render resolution — the
  // same computation `exportVideo` uses, so what the preview renders at is
  // genuinely what gets exported, not a separate on-screen-box-driven
  // guess (ARCHITECTURE.md, "preview and export must never diverge"). The
  // CSS `max-h-full max-w-full` below then scales that pixel buffer down
  // to fit whatever on-screen space is actually available, exactly like an
  // `<img>` would — the browser downsamples for display without touching
  // the underlying render resolution. Entirely unaffected by crop: crop
  // changes what the renderer treats as "the recording" (see the
  // `effectiveCrop`-keyed effect above), not the output frame's own size
  // — that's still purely `resolution`/`aspectRatioId`, same as before
  // crop existed.
  const { width: canvasWidth, height: canvasHeight } = computeOutputSize(
    resolutionPreset(resolution).longEdge,
    loaded.meta.display.widthPx,
    loaded.meta.display.heightPx,
    outputAspect,
  );
  // Where the video is actually drawn within the canvas (padding/aspect
  // aside) — `CropOverlay` needs this (not just the canvas's own on-screen
  // box) to position handles against the right spot, since crop mode's
  // `forceFullFrame` render still goes through the normal
  // background/padding/shadow pipeline. Must match `SceneRenderer`'s own
  // `contentRect` exactly — see `computeContentRect`'s doc comment for why
  // it's a shared export rather than a second copy of the formula.
  const cropContentRect = computeContentRect(canvasWidth, canvasHeight, style.padding, outputAspect);

  /** The top bar's "Crop" button — seeds the draft from the already-
   * confirmed crop if there is one (re-editing), or the full recording if
   * not (first crop). */
  function enterCropMode() {
    setDraftCrop(crop ?? fullFrameCrop(sourceFrameSize.width, sourceFrameSize.height));
    setCropMode(true);
  }

  /** "Confirm changes" — one `history.set` (a discrete edit, same as every
   * other document change), then back to the normal view. */
  function confirmCrop() {
    if (draftCrop) {
      const next = isFullFrameCrop(draftCrop, sourceFrameSize.width, sourceFrameSize.height) ? null : draftCrop;
      setDoc((d) => ({ ...d, crop: next }));
    }
    setCropMode(false);
    setDraftCrop(null);
  }

  /** "Discard changes" (or closing crop mode any other way) — the draft is
   * local state that was never written to `doc`, so there's nothing to
   * undo; just stop editing it. */
  function discardCrop() {
    setCropMode(false);
    setDraftCrop(null);
  }

  const selectedSlice = slices.find((s) => s.id === selectedSliceId);
  const selectedZoomKeyframe = selectedZoomIndex !== null ? zoomKeyframes[selectedZoomIndex] : undefined;
  const selectedMask = masks.find((m) => m.id === selectedMaskId);
  // Whether the selected mask's box should actually be showing right now —
  // the committed playhead has to be inside *that mask's own* time range,
  // not just "some mask is selected." Without this, `MaskOverlay` (and the
  // full-frame/effect-suppression it drives in `tick`) stayed visible no
  // matter where you scrubbed to while its panel was open, which read as
  // "the mask doesn't respect its own time range" — this is the fix for
  // that. Mirrored into a ref (assigned right below, not in an effect —
  // `tick` needs this frame's value, not last render's) so the render loop
  // can read it without becoming a dependency of that `useEffect`.
  const maskPreviewActive = selectedMask ? currentTime >= selectedMask.startS && currentTime < selectedMask.endS : false;
  maskPreviewActiveRef.current = maskPreviewActive;
  selectedMaskTypeRef.current = selectedMask?.type ?? null;

  return (
    <div className="relative flex h-screen w-screen flex-col bg-neutral-950 text-neutral-300">
      {cropMode && draftCrop && (
        <CropToolbar
          draftCrop={draftCrop}
          onChangeDraft={setDraftCrop}
          sourceFrameWidth={sourceFrameSize.width}
          sourceFrameHeight={sourceFrameSize.height}
        />
      )}
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
        hasCrop={crop !== null}
        onOpenCropEditor={enterCropMode}
        hasMasks={masks.length > 0}
        onAddMask={addMask}
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
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
          {/* Click to play/pause — the only way to control playback while
           * the timeline (which normally owns the play button) is hidden,
           * whether that's preview mode or just "Show editor timeline"
           * unchecked. Harmless as a global affordance either way. Disabled
           * while actively cropping so a click meant for a drag handle
           * can't also toggle playback underneath it. */}
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            onClick={cropMode ? undefined : togglePlay}
            className={`max-h-full max-w-full rounded-lg ${cropMode ? "" : "cursor-pointer"}`}
            title={cropMode ? undefined : isPlaying ? "Pause" : "Play"}
          />
          {cropMode && draftCrop && (
            <CropOverlay
              draftCrop={draftCrop}
              onChangeDraft={setDraftCrop}
              sourceFrameWidth={sourceFrameSize.width}
              sourceFrameHeight={sourceFrameSize.height}
              contentRect={cropContentRect}
              canvasPxWidth={canvasWidth}
              canvasPxHeight={canvasHeight}
              canvasRef={canvasRef}
            />
          )}
          {/* Not shown at the same time as `CropOverlay` — crop mode
           * replaces the whole top bar/footer with its own dedicated ones,
           * and `tick` is already forcing the same full-frame view either
           * way (see `maskPreviewActive`'s doc comment), so there's nothing
           * meaningful to show both at once. Also gated on
           * `maskPreviewActive` itself, not just "a mask is selected" — see
           * that constant's doc comment for why. */}
          {!cropMode && selectedMask && maskPreviewActive && (
            <MaskOverlay
              rect={selectedMask.rect}
              onChangeRect={updateMaskRectLive}
              onCommit={commitDoc}
              onDraggingChange={(dragging) => {
                maskDraggingRef.current = dragging;
              }}
              onDeselect={() => setSelectedMaskId(null)}
              ignoreRef={sidebarRef}
              frameWidth={effectiveFrameSize.width}
              frameHeight={effectiveFrameSize.height}
              contentRect={cropContentRect}
              canvasPxWidth={canvasWidth}
              canvasPxHeight={canvasHeight}
              canvasRef={canvasRef}
            />
          )}
        </div>
        {showSidebar && (
          // `className="contents"` (`display: contents`) makes this `<div>`
          // invisible to the flex layout — `IconRail`/the panel still lay
          // out as if they were direct children of the row above — while
          // still being a real DOM node `sidebarRef` can point at, for
          // `MaskOverlay`'s click-outside-to-deselect check.
          <div ref={sidebarRef} className="contents">
            <IconRail
              active={selectedSlice || selectedZoomKeyframe || selectedMask ? null : activeTool}
              onSelect={selectTool}
            />
            {selectedMask ? (
              <MaskEditorPanel
                mask={selectedMask}
                onChange={updateMask}
                onCommit={commitDoc}
                onRemove={removeMask}
                onFocusStart={() => handleSeek(selectedMask.startS)}
                onClose={() => setSelectedMaskId(null)}
              />
            ) : selectedSlice ? (
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
            ) : activeTool === "audio" ? (
              <AudioPanel
                settings={audioSettings}
                onChange={(next) => setDocTransient((d) => ({ ...d, audioSettings: next }))}
                onCommit={commitDoc}
                hasMicAudio={loaded.meta.hasMicAudio}
              />
            ) : activeTool === "animations" ? (
              <AnimationPanel
                settings={animationSettings}
                onChange={(next) => setDocTransient((d) => ({ ...d, animationSettings: next }))}
                onCommit={commitDoc}
              />
            ) : (
              <StylePanel
                style={style}
                onChange={(next) => setDocTransient((d) => ({ ...d, style: next }))}
                onCommit={commitDoc}
              />
            )}
          </div>
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
        src={mediaSrc(loaded.screenVideoUrl)}
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
            selectedSliceId={selectedSliceId}
            onSplitZoomKeyframe={handleSplitZoom}
            onSelectZoomKeyframe={selectZoomKeyframe}
            selectedZoomIndex={selectedZoomIndex}
            masks={masks}
            onChangeMasks={updateAllMasksLive}
            onSelectMask={selectMask}
            selectedMaskId={selectedMaskId}
            resolution={resolution}
            onChangeResolution={changeResolution}
            sourceWidthPx={loaded.meta.display.widthPx}
            sourceHeightPx={loaded.meta.display.heightPx}
          />
        </div>
      )}

      {cropMode && <CropFooter onConfirm={confirmCrop} onDiscard={discardCrop} />}
    </div>
  );
}
