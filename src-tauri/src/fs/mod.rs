//! Reading recordings back off disk — the editor-side complement to
//! `bundle::BundleWriter`, which only writes. Split out because the
//! reader's job (list recordings, load one for editing) is a different
//! surface than the writer's (called once, from inside an active capture).
//!
//! `BundleReader` transparently handles both on-disk forms: a single packed
//! `.dol` file (the only form new recordings take — see
//! `bundle::container`), and the `*.motionrec` directories old recordings
//! were left as. For `.dol` bundles, media entries are served over the
//! `dol://` custom scheme (`dol_protocol`), so the frontend gets URLs rather
//! than file paths; for legacy directories it gets the plain file paths it
//! turns into `asset:` URLs itself.

use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::bundle::{names, CursorTrack, RecordingMeta};
use crate::dol_protocol;

pub struct BundleReader {
    root: PathBuf,
    /// True when `root` is a single packed `.dol` file (zip), false when
    /// it's a plain `*.motionrec` directory.
    packed: bool,
}

impl BundleReader {
    /// Opens a recording at `root`, accepting either a single `.dol` file or
    /// a legacy `*.motionrec` directory. Both are validated to actually look
    /// like Dolly recordings (contain `meta.json`) before returning.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        let packed = root
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e == names::EXTENSION);
        let has_meta = if packed {
            has_zip_entry(&root, names::META).with_context(|| {
                format!("{} is not a valid Dolly recording (.dol)", root.display())
            })?
        } else {
            root.join(names::META).exists()
        };
        if !has_meta {
            anyhow::bail!(
                "{} is not a Dolly recording bundle (missing {})",
                root.display(),
                names::META
            );
        }
        Ok(Self { root, packed })
    }

    pub fn path(&self) -> &Path {
        &self.root
    }

    /// True when this is a single packed `.dol` file rather than a legacy
    /// `*.motionrec` directory.
    pub fn is_packed(&self) -> bool {
        self.packed
    }

    pub fn read_meta(&self) -> Result<RecordingMeta> {
        let bytes = self.read_entry(names::META)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn read_cursor_track(&self) -> Result<CursorTrack> {
        let bytes = self.read_entry(names::CURSOR)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    /// URL the frontend can feed a `<video>` (or `fetch`) to play this
    /// recording's screen capture. For packed `.dol` bundles this is a
    /// `dol://` URL served by `dol_protocol`; for legacy directories it's
    /// the absolute path to `screen.mov`, which the frontend turns into an
    /// `asset:` URL with `convertFileSrc`.
    pub fn screen_video_url(&self) -> String {
        if self.packed {
            dol_protocol::media_url(&self.root, names::SCREEN_VIDEO)
        } else {
            self.screen_video_path().display().to_string()
        }
    }

    /// Mic audio counterpart to `screen_video_url` — `None` when the
    /// recording has no mic track (callers should gate on
    /// `RecordingMeta.has_mic_audio`).
    pub fn mic_audio_url(&self) -> Option<String> {
        if self.packed {
            Some(dol_protocol::media_url(&self.root, names::MIC_AUDIO))
        } else {
            Some(self.mic_audio_path().display().to_string())
        }
    }

    /// Absolute path `screen.mov` *would* live at — only meaningful for
    /// legacy `*.motionrec` directories; every packed `.dol` bundle has a
    /// `screen.mov` inside it, just not as a standalone file.
    pub fn screen_video_path(&self) -> PathBuf {
        self.root.join(names::SCREEN_VIDEO)
    }

    /// Always returns the path `mic.wav` *would* live at, whether or not
    /// mic capture was actually enabled for this recording — callers must
    /// check `RecordingMeta.has_mic_audio` before trying to read it, the
    /// same way `screen_video_path` is unconditional but every recording is
    /// guaranteed to actually have a `screen.mov`.
    pub fn mic_audio_path(&self) -> PathBuf {
        self.root.join(names::MIC_AUDIO)
    }

    /// Removes the recording from disk — a single file for `.dol` bundles, a
    /// whole directory for legacy `*.motionrec`. The frontend is expected to
    /// have already confirmed with the user.
    pub fn remove(&self) -> Result<()> {
        if self.packed {
            std::fs::remove_file(&self.root)
                .with_context(|| format!("removing {}", self.root.display()))
        } else {
            std::fs::remove_dir_all(&self.root)
                .with_context(|| format!("removing {}", self.root.display()))
        }
    }

    fn read_entry(&self, name: &str) -> Result<Vec<u8>> {
        if self.packed {
            read_zip_entry(&self.root, name)
        } else {
            let path = self.root.join(name);
            std::fs::read(&path).with_context(|| format!("reading {}", path.display()))
        }
    }
}

/// Lists `*.dol` bundles directly inside `dir`, most recently modified
/// first — backs the recordings library the editor's main window opens into
/// (PRD §9, "the main window is for editing"). Legacy `*.motionrec`
/// directories are no longer listed (nothing new is written as one, and
/// they're openable from the file dialog), but a stray one still opens
/// fine via `BundleReader::open`.
pub fn list_recordings(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut bundles: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(dir)
        .with_context(|| format!("reading {}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension().and_then(|e| e.to_str()) == Some(names::EXTENSION)
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect();

    bundles.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    Ok(bundles.into_iter().map(|(_, path)| path).collect())
}

/// Reads one entry out of a `.dol` zip, decompressing if needed.
fn read_zip_entry(path: &Path, name: &str) -> Result<Vec<u8>> {
    let file = std::fs::File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .with_context(|| format!("{} is not a valid .dol file", path.display()))?;
    let mut entry = archive
        .by_name(name)
        .with_context(|| format!("{} does not contain {name}", path.display()))?;
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .with_context(|| format!("reading {name} from {}", path.display()))?;
    Ok(bytes)
}

fn has_zip_entry(path: &Path, name: &str) -> Result<bool> {
    let file = std::fs::File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .with_context(|| format!("{} is not a valid .dol file", path.display()))?;
    let found = archive.by_name(name).is_ok();
    Ok(found)
}
