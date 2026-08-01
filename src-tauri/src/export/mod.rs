//! `wgpu` compositing pass (backgrounds, transform, shadow, cursor overlay)
//! + VideoToolbox encode of the final output.
//!
//! Not built yet — this is M3, and it depends on the motion engine
//! (`frontend/src/motion-engine`) existing first, since export renders the
//! same resolved per-frame transforms the live preview uses. Building this
//! before that engine exists would mean guessing its output shape twice.
