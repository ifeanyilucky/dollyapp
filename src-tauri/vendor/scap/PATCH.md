# Dolly patch

Vendored from `scap` 0.0.8 (crates.io, MIT license) with one fix:
`src/targets/mac/mod.rs`'s `get_scale_factor`/`get_target_dimensions` used
`[NSApp windowWithWindowNumber:]` to resolve a `Target::Window`, which only
finds windows owned by the calling process. For any real capture target
(always a different app) that returns `nil`, which silently produced a 0×0
crop size and a 0.0 scale factor — and since `capturer::engine::mac`
multiplies those together for the stream's output frame size, window
capture collapsed to a 0×0 request that ScreenCaptureKit falls back to
"capture everything" for, instead of erroring.

Fixed to source both values from data that isn't scoped to the calling
process — see the "Dolly patch" comment block in that file for the full
explanation. No other files were changed.

Wired in via `[patch.crates-io]` in `src-tauri/Cargo.toml` rather than
forking on GitHub, since it's a small, self-contained fix pending upstream.
Safe to drop once a released `scap` version fixes this (tracked upstream:
https://github.com/helmerapp/scap — search for window target dimensions /
scale factor bugs before assuming a newer release has it fixed).
