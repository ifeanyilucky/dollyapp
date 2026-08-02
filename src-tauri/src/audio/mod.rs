//! Microphone capture via `AVAudioEngine`. System audio is deliberately
//! not here — it needs `SCStream`'s audio output, which shares plumbing
//! with the real video encoder (see `recorder::RECORDING_STATE_EVENT`'s
//! neighbor task, "screen.mov encoding") rather than `AVAudioEngine`.

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::MicRecorder;
