//! Capturable displays/windows, and mapping the frontend's plain-data
//! selection back onto `scap::Target` (which wraps a raw `CGDisplay`/
//! `CGWindowID` and isn't worth serializing over IPC as-is).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetKind {
    Display,
    Window,
}

#[derive(Debug, Clone, Serialize)]
pub struct TargetInfo {
    pub id: u32,
    pub kind: TargetKind,
    pub title: String,
}

impl From<&scap::Target> for TargetInfo {
    fn from(target: &scap::Target) -> Self {
        match target {
            scap::Target::Display(d) => TargetInfo {
                id: d.id,
                kind: TargetKind::Display,
                title: d.title.clone(),
            },
            scap::Target::Window(w) => TargetInfo {
                id: w.id,
                kind: TargetKind::Window,
                title: w.title.clone(),
            },
        }
    }
}

/// Displays first, then windows — matches the picker's expected grouping
/// (PRD §9: "Picker: full display / window / region").
pub fn list_targets() -> Vec<TargetInfo> {
    let targets = scap::get_all_targets();
    let mut displays: Vec<TargetInfo> = targets
        .iter()
        .filter(|t| matches!(t, scap::Target::Display(_)))
        .map(TargetInfo::from)
        .collect();
    let windows = targets
        .iter()
        .filter(|t| matches!(t, scap::Target::Window(_)))
        .map(TargetInfo::from);
    displays.extend(windows);
    displays
}

/// Re-resolves a `scap::Target` from an id + kind pair. Targets aren't
/// cached between listing and selecting — window/display sets can change
/// between the two (a window closes, a display disconnects), so a fresh
/// lookup is the only way to know the id is still valid.
pub fn resolve_target(id: u32, kind: TargetKind) -> Option<scap::Target> {
    scap::get_all_targets()
        .into_iter()
        .find(|t| match (t, kind) {
            (scap::Target::Display(d), TargetKind::Display) => d.id == id,
            (scap::Target::Window(w), TargetKind::Window) => w.id == id,
            _ => false,
        })
}

/// `scap` 0.0.8 doesn't publicly expose a "main display" getter (it exists
/// internally but isn't `pub`), so this re-derives it: find the
/// `Target::Display` whose id matches `CGDisplay::main()`, falling back to
/// the first display listed if that somehow doesn't match anything.
pub fn main_display() -> Option<scap::Target> {
    let main_id = core_graphics::display::CGDisplay::main().id;
    let targets = scap::get_all_targets();
    targets
        .iter()
        .find(|t| matches!(t, scap::Target::Display(d) if d.id == main_id))
        .or_else(|| {
            targets
                .iter()
                .find(|t| matches!(t, scap::Target::Display(_)))
        })
        .cloned()
}

/// Points-to-pixels scale factor for a target's display. `scap` doesn't
/// expose this either (same gap as `main_display`), so it's computed
/// directly via `CGDisplayMode`'s point vs. pixel width — no AppKit/main-
/// thread dependency, unlike the `NSScreen.backingScaleFactor` route.
/// Windows use their containing display's factor; since finding which
/// display a window is actually on needs more bookkeeping than this is
/// worth right now, this always uses the main display for windows, which
/// is correct on the common single/uniform-scale-factor setup.
pub fn scale_factor(target: &scap::Target) -> f64 {
    let display_id = match target {
        scap::Target::Display(d) => d.id,
        scap::Target::Window(_) => core_graphics::display::CGDisplay::main().id,
    };

    core_graphics::display::CGDisplay::new(display_id)
        .display_mode()
        .map(|mode| mode.pixel_width() as f64 / mode.width().max(1) as f64)
        .unwrap_or(1.0)
}
