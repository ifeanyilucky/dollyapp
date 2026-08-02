//! Toggling whether Dolly shows a Dock icon — backs the tray's "Show Dolly
//! in Dock" checkbox and the settings window's matching toggle. Both funnel
//! through `set_visible` (see `tray::set_show_in_dock`) so the persisted
//! preference (`settings::AppSettings`) and the actual on-screen state can
//! never drift apart.

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::set_visible;
