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

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

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

    /// System audio counterpart to `screen_video_url` — `None` when the
    /// recording has no system track (callers should gate on
    /// `RecordingMeta.has_system_audio`).
    pub fn system_audio_url(&self) -> Option<String> {
        if self.packed {
            Some(dol_protocol::media_url(&self.root, names::SYSTEM_AUDIO))
        } else {
            Some(self.system_audio_path().display().to_string())
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

    /// Always returns the path `system.wav` *would* live at, whether or not
    /// system audio capture was actually enabled for this recording —
    /// callers must check `RecordingMeta.has_system_audio` before trying to
    /// read it, the same way `screen_video_path` is unconditional but every
    /// recording is guaranteed to actually have a `screen.mov`.
    pub fn system_audio_path(&self) -> PathBuf {
        self.root.join(names::SYSTEM_AUDIO)
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

    /// The editor's saved `project.json` (`EditorDocument` on the frontend)
    /// — `None` when the recording has never been edited, which is the
    /// "absent until first edit" state ARCHITECTURE.md describes.
    pub fn read_project(&self) -> Option<String> {
        let bytes = if self.packed {
            read_zip_entry_optional(&self.root, names::PROJECT)?
        } else {
            std::fs::read(self.root.join(names::PROJECT)).ok()?
        };
        String::from_utf8(bytes).ok()
    }

    /// Replaces (or, on first edit, creates) the `project.json` entry. For
    /// legacy `*.motionrec` directories this is a plain file write; for
    /// packed `.dol` files the archive is rewritten — every existing entry
    /// streamed through with `project.json` swapped for the new value — to a
    /// temp file that's atomically renamed over the original, so `dol://`
    /// requests (which open the archive fresh per request) never observe a
    /// half-written bundle. Media entries keep their `Stored` compression
    /// and Zip64 flags so `dol_protocol`'s byte-range serving keeps working.
    pub fn write_project(&self, json: &str) -> Result<()> {
        if self.packed {
            rewrite_zip_with_project(&self.root, json)
        } else {
            let path = self.root.join(names::PROJECT);
            std::fs::write(&path, json).with_context(|| format!("writing {}", path.display()))
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

/// Same as `read_zip_entry` but returns `None` for a missing entry instead
/// of erroring — `project.json` legitimately doesn't exist until the first
/// edit is saved.
fn read_zip_entry_optional(path: &Path, name: &str) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;
    let mut entry = archive.by_name(name).ok()?;
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

/// Streams every entry of the `.dol` at `path` into a fresh archive with
/// `project.json` set to `json` (replacing any existing one), then swaps it
/// over the original. Entries are copied byte-for-byte with their original
/// compression and Zip64 layout, so nothing but the project entry changes.
fn rewrite_zip_with_project(path: &Path, json: &str) -> Result<()> {
    let tmp = PathBuf::from(format!("{}.tmp", path.display()));
    let rewritten = (|| -> Result<()> {
        let mut out = ZipWriter::new(
            std::fs::File::create(&tmp).with_context(|| format!("creating {}", tmp.display()))?,
        );
        let file = std::fs::File::open(path).with_context(|| format!("opening {}", path.display()))?;
        let mut archive = ZipArchive::new(file)
            .with_context(|| format!("{} is not a valid .dol file", path.display()))?;

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .with_context(|| format!("reading zip entry {i} from {}", path.display()))?;
            let name = entry.name().to_owned();
            let entry_name = name.clone();
            if name == names::PROJECT {
                continue; // replaced below
            }
            // Keep Stored media entries Stored + Zip64, and deflated JSON
            // entries deflated, exactly as `pack_recording` wrote them.
            let options = SimpleFileOptions::default()
                .compression_method(entry.compression())
                .large_file(name == names::SCREEN_VIDEO || name == names::MIC_AUDIO);
            out.start_file(name, options)
                .with_context(|| format!("starting zip entry {entry_name}"))?;
            std::io::copy(&mut entry, &mut out)
                .with_context(|| format!("writing zip entry {entry_name}"))?;
        }

        out.start_file(names::PROJECT, SimpleFileOptions::default())
            .with_context(|| format!("starting zip entry {}", names::PROJECT))?;
        out.write_all(json.as_bytes())
            .with_context(|| format!("writing zip entry {}", names::PROJECT))?;
        out.finish()
            .with_context(|| format!("finishing zip archive at {}", tmp.display()))?;
        Ok(())
    })();

    match rewritten {
        Ok(()) => std::fs::rename(&tmp, path)
            .with_context(|| format!("replacing {}", path.display())),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::container::pack_recording;
    use crate::bundle::{BundleWriter, CursorSample, CursorType, DisplayInfo, RecordingMeta};

    fn sample_meta() -> RecordingMeta {
        RecordingMeta {
            version: RecordingMeta::CURRENT_VERSION,
            clock_epoch: 1_000_000,
            video_start_us: 150_000,
            display: DisplayInfo {
                width_px: 2560,
                height_px: 1440,
                scale_factor: 2.0,
                origin_x: 0.0,
                origin_y: 0.0,
            },
            duration_us: 30_000_000,
            has_webcam: false,
            has_system_audio: false,
            has_mic_audio: false,
            fps: 60,
        }
    }

    fn sample_track(clock_epoch: u64) -> CursorTrack {
        let mut track = CursorTrack::new(clock_epoch);
        track.samples.push(CursorSample {
            t: 0,
            x: 100.0,
            y: 200.0,
            cursor_type: CursorType::Arrow,
        });
        track
    }

    #[test]
    fn reads_a_packed_dol_bundle_round_trip() {
        let staging = tempfile::tempdir().unwrap();
        let bundle_root = staging.path().join("staging.motionrec");
        let writer = BundleWriter::create(&bundle_root).unwrap();
        writer.write_meta(&sample_meta()).unwrap();
        writer.write_cursor_track(&sample_track(sample_meta().clock_epoch)).unwrap();
        std::fs::write(writer.screen_video_path(), b"fake-video-bytes").unwrap();

        let dest_dir = tempfile::tempdir().unwrap();
        let dest = dest_dir.path().join("Recording 1.dol");
        pack_recording(&bundle_root, &dest).unwrap();

        let reader = BundleReader::open(&dest).unwrap();
        assert!(reader.is_packed());
        assert_eq!(reader.read_meta().unwrap().fps, 60);
        assert_eq!(reader.read_cursor_track().unwrap().samples.len(), 1);
        assert!(
            reader.screen_video_url().starts_with("dol://"),
            "packed bundles must be served over dol://, got {}",
            reader.screen_video_url()
        );

        reader.remove().unwrap();
        assert!(!dest.exists());
    }

    #[test]
    fn still_reads_legacy_motionrec_directories() {
        let dir = tempfile::tempdir().unwrap();
        let bundle_path = dir.path().join("legacy.motionrec");
        let writer = BundleWriter::create(&bundle_path).unwrap();
        writer.write_meta(&sample_meta()).unwrap();
        writer.write_cursor_track(&sample_track(sample_meta().clock_epoch)).unwrap();

        let reader = BundleReader::open(&bundle_path).unwrap();
        assert!(!reader.is_packed());
        assert_eq!(reader.screen_video_url(), writer.screen_video_path().display().to_string());
        assert_eq!(reader.read_meta().unwrap().version, RecordingMeta::CURRENT_VERSION);
    }

    #[test]
    fn project_is_absent_until_first_save_then_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let bundle_path = dir.path().join("legacy.motionrec");
        let writer = BundleWriter::create(&bundle_path).unwrap();
        writer.write_meta(&sample_meta()).unwrap();
        writer.write_cursor_track(&sample_track(sample_meta().clock_epoch)).unwrap();
        let reader = BundleReader::open(&bundle_path).unwrap();
        assert_eq!(reader.read_project(), None, "unedithed bundle must have no project");

        reader.write_project(r#"{"crop":null}"#).unwrap();
        assert_eq!(reader.read_project().unwrap(), r#"{"crop":null}"#);
        // Reopening sees the saved project too (it's persisted, not held in
        // the reader instance).
        assert_eq!(
            BundleReader::open(&bundle_path).unwrap().read_project().unwrap(),
            r#"{"crop":null}"#
        );
    }

    #[test]
    fn writing_project_into_a_packed_dol_preserves_other_entries() {
        let staging = tempfile::tempdir().unwrap();
        let bundle_root = staging.path().join("staging.motionrec");
        let writer = BundleWriter::create(&bundle_root).unwrap();
        writer.write_meta(&sample_meta()).unwrap();
        writer.write_cursor_track(&sample_track(sample_meta().clock_epoch)).unwrap();
        std::fs::write(writer.screen_video_path(), b"fake-video-bytes").unwrap();

        let dest_dir = tempfile::tempdir().unwrap();
        let dest = dest_dir.path().join("Recording 1.dol");
        pack_recording(&bundle_root, &dest).unwrap();

        let reader = BundleReader::open(&dest).unwrap();
        assert!(reader.is_packed());
        assert_eq!(reader.read_project(), None);

        reader.write_project(r#"{"slices":[]}"#).unwrap();
        assert_eq!(reader.read_project().unwrap(), r#"{"slices":[]}"#);

        // The recording itself must be untouched by the rewrite: media entry
        // intact, still Stored, and everything else still readable.
        let file = std::fs::File::open(&dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut video = archive.by_name(names::SCREEN_VIDEO).unwrap();
        assert_eq!(video.compression(), zip::CompressionMethod::Stored);
        let mut video_bytes = Vec::new();
        video.read_to_end(&mut video_bytes).unwrap();
        assert_eq!(video_bytes, b"fake-video-bytes");
        drop(video);
        assert_eq!(reader.read_meta().unwrap().fps, 60);
        assert_eq!(reader.read_cursor_track().unwrap().samples.len(), 1);
    }
}
