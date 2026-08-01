# Dolly

Automatic cinematic screen recording for macOS — an open-source alternative to
Screen Studio.

Dolly records the screen and the cursor as two separate data streams, then
generates zoom and pan motion from the cursor data automatically — smooth,
eased, and fully editable after the fact. Nothing is burned into the capture:
the recording is raw pixels at native retina resolution plus a timestamped
cursor track, so motion can be retimed or deleted after the fact and the
output is always cropped from a high-resolution source rather than scaled up
from a low-resolution one.

> **Status:** pre-alpha, mid-M1 (recorder core). Permissions, menu bar,
> global hotkey, and a real start/stop/pause recording flow all work; there's
> no target picker (full display only) and no real `screen.mov` encoding yet
> (frames are written as a PNG sequence — see `src-tauri/src/capture/`). Not
> ready for use.

## Why

Raw screen recordings are bad video: the viewer can't find the cursor, UI
text is unreadable, and nothing directs attention. Fixing that today means
manual keyframing in a general-purpose video editor. Dolly automates it.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full technical design and
the rationale behind every non-obvious decision in this codebase.

## Architecture

```
frontend/    React + TypeScript editor UI, timeline, motion engine, WebGL preview
src-tauri/   Rust core — capture, cursor hooks, encode, export, filesystem
```

The split is deliberate: everything that defines the product's feel (motion
smoothing, zoom generation, easing) lives in TypeScript for a fast iteration
loop. Everything that touches the OS (ScreenCaptureKit, VideoToolbox,
AVFoundation) lives in Rust, written once and rarely touched.

Preview and export share one motion engine (`frontend/src/motion-engine`) so
they can never visually diverge — see `ARCHITECTURE.md`.

Full stack: Tauri v2, Rust (`objc2`/`scap`, `wgpu`, VideoToolbox), React 18,
Zustand, WebGL2, Tailwind + Radix. Details in `ARCHITECTURE.md`.

## Requirements

- macOS 13.0+ (Ventura), Intel or Apple Silicon
- [Rust](https://rustup.rs) (stable toolchain)
- Node.js 20+ and [pnpm](https://pnpm.io)
- Xcode command line tools (`xcode-select --install`)

## Development

```bash
pnpm install
pnpm tauri dev
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full workflow, and
`.claude/skills/` if you're using Claude Code against this repo.

## Recording format

A recording is a bundle directory (`*.motionrec/`), not a single file —
screen video, optional webcam/audio, a `cursor.json` track sampled at 120Hz,
and a `project.json` holding non-destructive user edits. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the full schema and the reasoning
behind the shared-clock requirement between the video and cursor streams.

## License

[GNU AGPL v3.0](LICENSE). Dolly is open source; a commercial licence key is
planned to unlock the packaged app — this is standard for AGPL-licensed
open-core products and doesn't restrict you from building and running the
code yourself.

## Prior art

- [Cap](https://cap.so) — open source, Tauri + Rust, closest architectural
  match. Worth reading before writing capture/export code of your own.
- [Screen Studio](https://screen.studio) — the quality bar this project is
  measured against.
- Casiez, Roussel, Vogel, "1€ Filter" (CHI 2012) — the cursor smoothing
  algorithm used in the motion engine.
