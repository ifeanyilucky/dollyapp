# Contributing

Dolly is pre-alpha and the architecture is still settling — read
[`ARCHITECTURE.md`](ARCHITECTURE.md) fully before sending a PR. Two
rules matter more than any other in this codebase:

1. **Preview and export must never diverge.** The motion engine
   (`frontend/src/motion-engine`) is the single source of truth for
   zoom/pan/easing math. Don't duplicate it in the Rust exporter — the
   exporter reads resolved transforms produced by the shared engine.
2. **The two data streams (video, cursor) share one clock.** Any code that
   timestamps cursor or video events must derive from the `mach_absolute_time`
   epoch recorded in `meta.json`, never from wall-clock time.

## Setup

```bash
pnpm install
pnpm tauri dev
```

Requires Rust (stable), Node 20+, pnpm, and Xcode command line tools.

## Where things live

| Path | What |
|---|---|
| `frontend/src/motion-engine/` | Smoothing (One Euro filter), auto-zoom generation, spring easing — shared by preview and export |
| `frontend/src/permissions/` | Pre-prompt screen gating the app behind Screen Recording access |
| `frontend/src/recorder/` | Start/stop/pause UI, synced with tray + hotkey via a Tauri event |
| `frontend/src/state/` | Zustand editor state |
| `frontend/src/timeline/` | Hand-rolled canvas timeline |
| `frontend/src/preview/` | WebGL2 live preview compositor |
| `src-tauri/src/capture/` | Screen frame capture (`scap`) — currently a PNG-sequence stand-in, see the module doc comment |
| `src-tauri/src/cursor/` | Global cursor/click/key monitoring; owns the main-thread-confined `NSEvent` monitor |
| `src-tauri/src/permissions/` | Screen/mic/camera status checks, lazy requests, System Settings deep links |
| `src-tauri/src/recorder/` | Orchestrates one recording: capture + cursor tracking + bundle writing, start/stop/pause/resume |
| `src-tauri/src/tray/` | Menu bar icon — the primary entry point (PRD §9) |
| `src-tauri/src/shortcut.rs` | Global `⌥⌘2` hotkey, shares `tray::toggle_recording` |
| `src-tauri/src/commands/` | Thin `#[tauri::command]` wrappers around the modules above — logic stays out of this layer |
| `src-tauri/src/encode/` | VideoToolbox encode — not built yet, see module doc comment |
| `src-tauri/src/export/` | wgpu compositing + export pipeline — not built yet |
| `src-tauri/src/fs/` | `.motionrec` bundle read/write |
| `src-tauri/capabilities/` | Tauri v2 ACL grants for the frontend — a command added here needs a matching permission or `invoke()` fails at runtime |

## Before opening a PR

- `pnpm lint && pnpm typecheck` on the frontend
- `cargo fmt --check && cargo clippy` in `src-tauri`
- If you touched capture, cursor sync, or the motion engine, state in the PR
  description how you verified sync/parity — these are the two things that
  silently break.

## License

By contributing, you agree your contribution is licensed under the project's
[AGPL-3.0 license](LICENSE).
