//! VideoToolbox hardware encode: `capture`'s raw frames -> `screen.mov`.
//!
//! Not built yet. Belongs to M1 (recorder core needs a real `screen.mov`,
//! not the M0 PNG sequence) — see `src-tauri/src/capture/mod.rs` for why
//! M0 deliberately doesn't produce one. Expected shape once it exists:
//! a `VideoToolboxEncoder` that takes `capture::CapturedFrame`s (switched
//! to YUV BiPlanar by then) and an `AVAssetWriter` sink, so it stays
//! GPU-resident end to end per ARCHITECTURE.md's capture table.
