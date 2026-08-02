//! VideoToolbox-backed encode: capture's BGRA frames -> a real `screen.mov`.
//!
//! Goes through `AVAssetWriter` rather than a hand-rolled `VTCompressionSession`
//! — `AVAssetWriterInputPixelBufferAdaptor` accepts `kCVPixelFormatType_32BGRA`
//! directly (see the doc comment on `appendPixelBuffer:withPresentationTime:`
//! in Apple's headers), so `capture`'s existing BGRA frames need no format
//! conversion to reach it. This sidesteps needing to hand-roll `SCStream`/
//! `SCStreamOutput` (which would need `objc2::define_class!` protocol
//! conformance — a substantially larger undertaking) since `scap` already
//! does that capture-side work; only the encode-and-mux side was missing.
//!
//! System audio is still not here — it would need that same hand-rolled
//! `SCStream` audio output, so it stays deferred alongside it.

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::MovWriter;
