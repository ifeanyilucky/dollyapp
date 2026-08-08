# Feature Gaps

Where Dolly stands against Screen Studio and the wider screen-recorder market,
and what to build next.

Scope: research snapshot against Screen Studio (screen.studio), Cap, CursorClip,
ScreenKite, CleanShot X, and Loom as of August 2026. Evidence from code is cited
with `file:line` references; features verified absent via exhaustive grep.

## Dolly's current state

Dolly is pre-alpha but the editor core is unusually complete for its stage:

- Automatic zoom generation from the cursor track
- One Euro cursor smoothing with animation presets
- Manual zoom keyframes, pan-follows-live-cursor, spring easing
- Slices (cut / speed-up / remove), masks (sensitive + highlight), crop
- Style: wallpapers, gradients, custom image, shadow, inset, padding, corners
- Background music, click sounds, mic narration playback
- Cursor: 16 glyph styles, size, motion blur, idle-hide, loop-position, click effects
- MP4 / WebM export via MediaRecorder
- `.dol` single-file bundle, `dol://` byte-range streaming, project persistence,
  autosave, undo/redo
- Tray app, 5 global hotkeys, region / window / display capture, mic capture,
  pause/resume, discard, permissions flow

## P0 — blocks the core promise

### System audio capture — DONE
Screen Studio, Loom, Cap, CleanShot X, CursorClip, ScreenKite all capture system
audio; Dolly now does too. A dedicated audio-only `SCStream` (`SCStreamOutput`
type `.Audio`) writes `system.wav` alongside `mic.wav`
(`src-tauri/src/audio/system.rs`, `SystemAudioRecorder`), `has_system_audio`
is wired through `RecordingMeta`/the `.dol` packer, and the source picker has a
live System audio toggle (`frontend/src/recorder/SourcePickerBar.tsx`). Mic and
system audio stay as separate WAV tracks the editor can mix/drop at export time.

Remaining (small):
- Surface the system audio track in the editor (it's written, packed, and
  servable over `dol://` as `audio/wav`, but not yet exposed in the UI).
- Volume mixing/normalization (P2 anyway).

### Native Rust export pipeline — MISSING
`src-tauri/src/export/mod.rs` is a 7-line stub ("Not built yet — this is M3").
Real export runs in the frontend via `MediaRecorder`
(`frontend/src/editor/exportVideo.ts:60-72`), which caps quality and rules out
HEVC, ProRes, GIF, and export presets. The planned `wgpu` + VideoToolbox
compositing pipeline (ARCHITECTURE.md §Export) needs to be built so preview and
export both render from the same motion math but encode natively.

Work required:
- wgpu compositing pass (backgrounds, transform, shadow, cursor overlay).
- VideoToolbox HEVC/H.264 encode; ProRes 422 LT intermediate option.
- GIF path via `gifski` (already a dependency).
- Export presets (web / social / editor), 4K 60fps, quick export.

### Webcam recording + PiP layout — MISSING
Screen Studio records the webcam with dynamic layouts: full-frame intros,
hide-camera-for-portions, resizable/repositionable overlay, custom aspect
ratio, and auto-zoom-out to keep the overlay clear of the cursor. Dolly has
camera permission plumbing only: `has_webcam: false` everywhere
(`src-tauri/src/recorder/macos.rs:239`, `src-tauri/src/fs/mod.rs:300`); the
`webcam.mov` constant is unused; the camera toggle in
`frontend/src/recorder/SourcePickerBar.tsx:46-56` is inert; the webcam icon in
`frontend/src/editor/IconRail.tsx:17-25` is a no-op.

Work required:
- Capture the webcam via `AVCaptureSession` (device → `webcam.mov`) alongside
  the screen stream on the same clock.
- Editor overlay: position/size/aspect, per-slice hide, full-frame intro,
  rounded corners matching the video.

## P1 — high impact, moderate effort

### GIF export — MISSING
Screen Studio ships high-quality GIFs (color-palette optimized, loop-count
settings). CursorClip and CleanShot X too. Dolly: MP4/WebM only
(`exportVideo.ts:60-72`); `gifski` listed in ARCHITECTURE.md but never wired.
Follows from the native export pipeline.

### Keyboard shortcut display — PARTIAL (capture only)
Screen Studio records keystrokes and renders them in the video, with a dedicated
timeline, per-key visibility, and a hide-all option. Dolly captures key *codes*
only (`src-tauri/src/cursor/macos.rs:231-289`) and never renders them — no
keystroke/shortcut overlay anywhere in the frontend. The codes are already there;
rendering is the missing half.

### Transcript + captions — MISSING
Screen Studio generates on-device transcripts (Apple Speech Recognition) and
shows them as captions. Loom/Cap auto-transcribe with chapters and summaries.
Dolly: no transcript/subtitle/caption code at all.

### Video import + drag & drop — MISSING
Screen Studio creates projects from any `.mp4`/`.mov`, with drag & drop onto the
editor or tray icon. Dolly opens only its own `.dol` bundles; no import, no
file-drop handling. Cheap to add once the bundle reader accepts foreign media.

## P2 — polish / product decisions

- Audio enhancement (volume normalization, noise removal) — standard across
  competitors.
- Export presets + quick export + copy-to-clipboard export.
- Shareable links (+ private links, comments, view counts) — requires an account
  / cloud decision; Cap/Loom differentiate here.
- Vertical-mode zoom auto-adjustment (Dolly has aspect presets but doesn't
  re-plan zoom keyframes for vertical output).
- Command menu (⌘K), batch / multi-project export, project recovery, low-disk
  warnings, quick-share widget.
- Customizable shortcuts and a real settings surface (only `show_in_dock` is
  persisted today — `src-tauri/src/settings.rs:13-15`).
- System-cursor high-res replacement and live cursor-shape resolution
  (`CursorType` is hardcoded `Arrow` — `src-tauri/src/cursor/macos.rs:213-218`).
- Screenshot mode with annotations (CleanShot X / Cap territory).

## Not yet worth chasing

Screen Studio roadmap items: AI voiceover, teams subscriptions, annotations,
full-text slides, enter/exit animations, screenshots-to-video.

## Competitive differentiators to consider

- Cap: cross-platform (Win/Linux), self-hosting, bring-your-own S3/GDrive.
- Loom: viewer analytics, timestamped comments/reactions, team workspaces.
- CleanShot X: scrolling capture, annotation tools, OCR, pin-to-desktop.
- ScreenKite: 3× faster Metal-accelerated export — validates the native export
  pipeline priority above.

## Ground truth that must never regress

- Preview and export run the same motion math (`frontend/src/motion-engine`).
- Shared clock (`mach_absolute_time`) between video and cursor streams.
- Zoom is never burned into the capture (non-destructive).
