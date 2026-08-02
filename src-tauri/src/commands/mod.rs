//! Tauri commands — the IPC surface the frontend calls via `invoke()`.
//! Kept thin: each command delegates to a plain-Rust module (`permissions`,
//! `recorder`, ...) rather than holding logic itself, so that logic stays
//! testable without spinning up a Tauri app.

mod area_selector;
mod capture;
mod editor;
mod export;
mod permissions;
mod recorder;
mod settings;
mod toolbar;
mod window_picker;

pub use area_selector::*;
pub use capture::*;
pub use editor::*;
pub use export::*;
pub use permissions::*;
pub use recorder::*;
pub use settings::*;
pub use toolbar::*;
pub use window_picker::*;
