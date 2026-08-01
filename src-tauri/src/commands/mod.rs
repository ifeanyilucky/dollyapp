//! Tauri commands — the IPC surface the frontend calls via `invoke()`.
//! Kept thin: each command delegates to a plain-Rust module (`permissions`,
//! `recorder`, ...) rather than holding logic itself, so that logic stays
//! testable without spinning up a Tauri app.

mod capture;
mod permissions;
mod recorder;

pub use capture::*;
pub use permissions::*;
pub use recorder::*;
