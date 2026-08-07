//! Audio capture.
//!
//! - `mic::MicRecorder`: the user's microphone, via `AVAudioEngine`'s input
//!   node tap.
//! - `system::SystemAudioRecorder`: everything the machine plays (apps,
//!   alerts, other devices routed to output), via a ScreenCaptureKit
//!   `SCStream` whose audio output we write straight to a WAV file.
//!
//! Both are kept out of the video/cursor capture pipeline on purpose: they
//! write standalone WAV files that the editor can mix/drop at export time.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod system;

#[cfg(target_os = "macos")]
pub use macos::MicRecorder;
#[cfg(target_os = "macos")]
pub use system::SystemAudioRecorder;
