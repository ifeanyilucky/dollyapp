# Architecture

Technical reference for how Dolly is built. This is the public subset of the
project's design docs — business/pricing/licensing strategy lives outside
this repo.

## The core insight

Zoom is never burned into the capture. A recording is raw pixels at native
retina resolution plus a timestamped cursor track. Motion (zoom/pan) is a
non-destructive transform applied at playback and re-applied at export. That
means:

- Any zoom can be retimed, reshaped, or deleted after recording.
- Output is always cropped from a high-resolution source rather than scaled
  up from a low-resolution one — it stays sharp at any zoom level.

Tools that composite motion into the capture during recording can't do
either of these. It's the main architectural bet this project makes, and
most other decisions defer to it.

## System diagram

```
┌─────────────────────────────────────────────────┐
│  Frontend  —  React + TypeScript (Tauri WebView) │
│  Editor UI · timeline · motion engine · preview  │
└───────────────────┬─────────────────────────────┘
                    │  Tauri IPC (commands + events)
┌───────────────────┴─────────────────────────────┐
│  Core  —  Rust                                   │
│  capture · cursor hooks · encode · export · fs   │
└───────────────────┬─────────────────────────────┘
                    │  objc2 / FFI
┌───────────────────┴─────────────────────────────┐
│  macOS  —  ScreenCaptureKit · AVFoundation       │
│  VideoToolbox · CoreGraphics · Metal             │
└─────────────────────────────────────────────────┘
```

The split is deliberate. Everything that defines the product's *feel* —
smoothing, zoom generation, easing — lives in TypeScript, the language with
the fastest edit-refresh loop, because it's the part that gets iterated on
constantly. Everything that touches the OS lives in Rust: written once,
rarely touched.

**Preview and export must run the same motion math.** The motion engine
(`frontend/src/motion-engine`) is a pure TypeScript module with no DOM/WebGL
dependency; the live preview reads resolved transforms from it, and so does
the Rust export pipeline (via a values, not logic, handoff — see
`src-tauri/src/export`). If preview and export diverge, the result is bug
reports that can't be reproduced.

## Tech stack

### Shell — Tauri v2
Small binaries, a native WebView, and a real Rust core instead of writing
native addons inside an Electron app.

### Capture — Rust
| Concern | Choice | Notes |
|---|---|---|
| Screen capture | `ScreenCaptureKit` via `objc2` | macOS 13+. `scap` crate evaluated first for coverage |
| Pixel format | `kCVPixelFormatType_420YpCbCr8BiPlanarFullRange` | Stays GPU-resident, feeds VideoToolbox directly |
| Cursor position | `NSEvent.addGlobalMonitorForEvents` | Lighter than CGEventTap; no Input Monitoring prompt |
| Clicks / keys | Same global monitor (`.leftMouseDown` etc.) | Captures key *codes* only, never text content |
| Encode | VideoToolbox, HEVC hardware | ProRes 422 LT as an intermediate option |
| Audio | `AVAudioEngine` + `ScreenCaptureKit` audio | System audio via SCK, mic via AVAudioEngine |
| Clock | `mach_absolute_time` for both streams | Non-negotiable — see "Recording format" below |

### Editor — TypeScript
- React 18 + Vite
- Zustand for editor state
- WebGL2 for live preview compositing (custom shaders, no library)
- Tailwind + Radix primitives for UI chrome
- Timeline is hand-rolled on canvas

### Export — Rust
- `wgpu` for the compositing pass (backgrounds, transform, shadow, cursor
  overlay) targeting Metal
- VideoToolbox for encode
- `gifski` for GIF export (avoids an FFmpeg dependency entirely)

## Recording format

A recording is a **bundle directory**, not a single file:

```
MyRecording.motionrec/
├── meta.json          # version, display info, scale factor, duration, clock epoch
├── screen.mov          # HEVC or ProRes, native retina resolution, 60fps
├── webcam.mov           # optional
├── system.wav           # optional
├── mic.wav               # optional
├── cursor.json         # cursor samples + input events
└── project.json        # user edits — keyframes, trims, style. Absent until first edit
```

`cursor.json` samples cursor position at **120Hz even though video is
60fps** — the smoothing filter needs oversampled input, and the extra data
is a few hundred KB per minute.

**Both streams share one clock.** `mach_absolute_time` is captured the
moment the first video frame lands and stored as `clockEpoch` in
`meta.json`; every cursor timestamp is microseconds since that epoch. Mixing
`Date.now()` on one side with a video PTS on the other causes drift that
compounds over a recording — it can reach hundreds of milliseconds by the
20-minute mark, and it presents as "this feels a little off" rather than a
clean bug. See `src-tauri/src/bundle` for the shared types.

## The motion engine

### Path smoothing
A **One Euro filter** (Casiez, Roussel, Vogel — CHI 2012) is applied to the
raw x/y cursor stream. It adapts: aggressive smoothing while the cursor is
nearly still, low lag while it's moving fast — which is exactly the
behavior cursor motion needs. Starting parameters (tuned by eye, exposed in
a dev panel):

```
mincutoff = 1.0    // lower = smoother when still
beta      = 0.007  // higher = less lag when moving fast
dcutoff   = 1.0
```

### Automatic zoom generation
1. Segment the timeline into ~200ms windows classified `idle`, `traveling`,
   or `interacting` by velocity and event density.
2. Cluster clicks/scrolls/typing runs within ~1.2s and ~300px into attention
   anchors.
3. Each cluster becomes a zoom-in block starting ~400ms before the first
   anchor (leading reads as intentional; trailing reads as reactive) and
   holding until ~800ms after the last.
4. Drop zooms shorter than 1.2s; merge zooms separated by less than 800ms;
   cap zoom changes to roughly one per 2.5s.
5. Zoom level comes from cluster spread (tight → 2.0x, wide → 1.4x),
   clamped to 1.2x–3.0x, with the viewport constrained to stay inside frame
   bounds.
6. A block held 6s or longer gets split into three: the original level, a
   ~1.6s dip back to 1x around the midpoint, then back to the original
   level — a long static hold otherwise reads as "stuck" rather than a
   deliberate hold.

### Pan follows the live cursor, not a fixed point
While a zoom keyframe is active, the pan target is the cursor's current
(smoothed) position, continuously — not the cluster's fixed centroid held
for the block's whole duration. A fixed hold reads as "zoomed near the
action"; a live follow reads as "focused on the action," which is the
actual goal. The keyframe still governs *when* a zoom starts/ends and *how
far* it goes (`level`); only the pan target became live.

### Easing
Zoom transitions use a **critically damped spring**, not a bezier curve —
springs settle without overshoot and their duration scales naturally with
distance. Pan and zoom no longer share one spring clock: pan is now
continuously re-targeted (chasing a moving cursor, not jumping once between
two fixed points), so it needs to stay stiffer/more responsive than zoom
level, which can afford to be slower and more cinematic.

```
zoom level: stiffness = 40   // slower, unhurried
pan:        stiffness = 90   // responsive enough to keep the cursor
                              // comfortably inside the cropped viewport
damping = 2 * sqrt(stiffness)   // critical damping, both springs
```

### Cursor rendering
The system cursor is excluded from capture (`SCStreamConfiguration.showsCursor
= false`) and redrawn from the cursor track instead. This makes cursor size
independent of zoom level, lets motion be smoothed, enables click ripple
effects, and keeps the cursor correctly scaled at any viewport zoom.

## Permissions

- **Screen Recording** (TCC) — mandatory, requested with a custom
  explanation screen before the system prompt.
- **Accessibility** — avoided; `NSEvent` global monitors cover cursor/click/key
  tracking without it.
- **Microphone** / **Camera** — requested lazily, only when the user enables
  mic or webcam.
- Denied-state detection deep-links into the exact System Settings pane.

## Prior art

- [Cap](https://cap.so) — open source, Tauri + Rust, closest architectural
  match. Worth reading before writing capture/export code of your own.
- One Euro filter — Casiez, Roussel, Vogel, CHI 2012.
- WWDC 2022 "Meet ScreenCaptureKit" and its follow-up session.
