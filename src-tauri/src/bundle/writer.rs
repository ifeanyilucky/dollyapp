use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use super::{names, CursorTrack, RecordingMeta};

/// Creates and populates a `*.motionrec` bundle directory. Capture writes
/// `screen.mov` (and optionally webcam/audio) directly via its own
/// file handles; this only owns `meta.json` and `cursor.json`, written once
/// capture has stopped.
pub struct BundleWriter {
    root: PathBuf,
}

impl BundleWriter {
    /// `root` should end in `.motionrec`; created if it doesn't exist.
    pub fn create(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(&root)
            .with_context(|| format!("creating bundle directory at {}", root.display()))?;
        Ok(Self { root })
    }

    pub fn path(&self) -> &Path {
        &self.root
    }

    pub fn screen_video_path(&self) -> PathBuf {
        self.root.join(names::SCREEN_VIDEO)
    }

    pub fn write_meta(&self, meta: &RecordingMeta) -> Result<()> {
        let path = self.root.join(names::META);
        let json = serde_json::to_vec_pretty(meta)?;
        std::fs::write(&path, json).with_context(|| format!("writing {}", path.display()))
    }

    pub fn write_cursor_track(&self, track: &CursorTrack) -> Result<()> {
        let path = self.root.join(names::CURSOR);
        let json = serde_json::to_vec_pretty(track)?;
        std::fs::write(&path, json).with_context(|| format!("writing {}", path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::{CursorSample, CursorType, DisplayInfo};

    #[test]
    fn writes_meta_and_cursor_track_that_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let bundle_path = dir.path().join("test.motionrec");
        let writer = BundleWriter::create(&bundle_path).unwrap();

        let meta = RecordingMeta {
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
        };
        writer.write_meta(&meta).unwrap();

        let mut track = CursorTrack::new(meta.clock_epoch);
        track.samples.push(CursorSample {
            t: 0,
            x: 100.0,
            y: 200.0,
            cursor_type: CursorType::Arrow,
        });
        writer.write_cursor_track(&track).unwrap();

        let read_meta: RecordingMeta =
            serde_json::from_slice(&std::fs::read(bundle_path.join(names::META)).unwrap()).unwrap();
        assert_eq!(read_meta.clock_epoch, meta.clock_epoch);

        let read_track: CursorTrack =
            serde_json::from_slice(&std::fs::read(bundle_path.join(names::CURSOR)).unwrap())
                .unwrap();
        assert_eq!(read_track.samples.len(), 1);
        assert_eq!(read_track.clock_epoch, meta.clock_epoch);
    }
}
