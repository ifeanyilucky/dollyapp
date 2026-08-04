# Patches vs. crates.io scap 0.0.8

Both patches live in the local tree at `src-tauri/vendor/scap` and are wired
in via `[patch.crates-io]` in `src-tauri/Cargo.toml`.

## Window-target dimension/scale-factor lookup

scap 0.0.8's window-target lookup is broken for any window not owned by this
process — silently falling back to recording the whole display. Patched in
`src/targets/mac/mod.rs`.

## Unbounded frame blocking

`Capturer::get_next_frame` blocks forever in the frame channel, so a stream
that ScreenCaptureKit silently stalls (no frames, no error callback) parks
the capture thread forever. Added `Capturer::recv_timeout` (bounded wait
that also surfaces the stream error flag) and `Engine::has_error`; the app's
`capture::FrameGrabber::run_while` polls with them plus a stall watchdog so
`recorder::stop` can never hang. Changes in `src/capturer/mod.rs` and
`src/capturer/engine/mod.rs`.

## Public `targets` module

`Target::Window`'s payload struct lives in the (previously private) `targets`
module, so the app couldn't construct an exclusion target for its own
windows. Made `mod targets` public; no behavior change.
