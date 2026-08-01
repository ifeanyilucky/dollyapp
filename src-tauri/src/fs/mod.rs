//! Reading `.motionrec` bundles back off disk — the editor-side complement
//! to `bundle::BundleWriter`, which only writes. Split out because the
//! reader's job (list recordings, load one for editing) is a different
//! surface than the writer's (called once, from inside an active capture).

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::bundle::{names, CursorTrack, RecordingMeta};

pub struct BundleReader {
    root: PathBuf,
}

impl BundleReader {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        if !root.join(names::META).exists() {
            anyhow::bail!("{} is not a Dolly recording bundle (missing {})", root.display(), names::META);
        }
        Ok(Self { root })
    }

    pub fn path(&self) -> &Path {
        &self.root
    }

    pub fn read_meta(&self) -> Result<RecordingMeta> {
        let path = self.root.join(names::META);
        let bytes = std::fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn read_cursor_track(&self) -> Result<CursorTrack> {
        let path = self.root.join(names::CURSOR);
        let bytes = std::fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn screen_video_path(&self) -> PathBuf {
        self.root.join(names::SCREEN_VIDEO)
    }
}

/// Lists `*.motionrec` bundles directly inside `dir`, most recently
/// modified first — backs the recordings library the editor's main window
/// opens into (PRD §9, "the main window is for editing").
pub fn list_recordings(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut bundles: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(dir)
        .with_context(|| format!("reading {}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().and_then(|e| e.to_str()) == Some(names::EXTENSION))
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect();

    bundles.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(bundles.into_iter().map(|(_, path)| path).collect())
}
