//! Video import — turning a foreign `.mp4`/`.mov`/... into a Dolly recording
//! bundle so the editor can open it like any other recording (Screen Studio's
//! "create a project from any video" — see FEATURE_GAPS.md). The imported
//! file becomes `screen.mov` in a staging dir, wrapped with a synthetic
//! `meta.json` + empty `cursor.json`, then packed to a normal `.dol` in
//! `~/Movies/Dolly` — so imports are indistinguishable from real recordings
//! to everything downstream (`load_recording`, `dol://` serving, the recent
//! list, reveal/delete/export).
//!
//! The only piece of "real" data an import needs from the file is its video
//! geometry (resolution), duration, and frame rate — read with AVFoundation
//! (`AVURLAsset`), the same 0.6-objc2 generation the recorder's encoder and
//! audio already use. Cursor/audio tracks are empty (an imported video has
//! no cursor or narration/system audio); `clock_epoch`/`video_start_us` are
//! 0 so the editor's `t = currentTime * 1_000_000` mapping stays exact.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use objc2_av_foundation::{AVMediaTypeVideo, AVURLAsset};
use objc2_core_media::CMTimeFlags;
use objc2_foundation_avf::NSURL;
use tauri::{AppHandle, Manager};

use crate::bundle::container::pack_recording;
use crate::bundle::{names, BundleWriter, CursorTrack, DisplayInfo, RecordingMeta};
use crate::projects;

/// Extensions accepted for import. Deliberately includes a few common video
/// containers beyond the `.mp4`/`.mov` the gap description names — cheap to
/// accept, and AVFoundation either reads them or the import fails cleanly.
const ACCEPTED_EXTENSIONS: [&str; 5] = ["mp4", "mov", "m4v", "mkv", "webm"];

pub fn is_importable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ACCEPTED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Copies `video_path`'s media into a new `.dol` recording and returns its
/// path. `video_path` must be an importable video file (see
/// `ACCEPTED_EXTENSIONS`).
pub fn import_video(app: &AppHandle, video_path: &str) -> Result<PathBuf> {
    let cache = app
        .path()
        .app_cache_dir()
        .context("could not resolve the app cache directory")?;
    let recordings = projects::recordings_dir(app)?;
    import_video_into(&cache, &recordings, video_path)
}

/// The full import pipeline, parameterized over the two directories it needs
/// (staging scratch space and the `~/Movies/Dolly` destination) so tests can
/// point both at temp dirs instead of a live `AppHandle`.
pub fn import_video_into(cache_dir: &Path, recordings_dir: &Path, video_path: &str) -> Result<PathBuf> {
    let src = Path::new(video_path);
    if !src.is_file() {
        bail!("{} is not a file", src.display());
    }
    if !is_importable(src) {
        bail!(
            "unsupported video format (accepted: {})",
            ACCEPTED_EXTENSIONS.join(", ")
        );
    }

    let VideoMetadata {
        width,
        height,
        duration_us,
        fps,
    } = read_video_metadata(src)?;

    let base = recordings_dir.to_path_buf();
    std::fs::create_dir_all(&base)
        .with_context(|| format!("creating {}", base.display()))?;
    let name = unique_name(&base, &import_name(src));
    let dol_path = base.join(format!("{name}.dol"));

    // Stage as a loose `.motionrec` dir (the same shape a real recording's
    // staging dir is), then pack it to `.dol` and drop the staging dir.
    let staging = cache_dir
        .join("import-staging")
        .join(format!("{name}.motionrec"));
    if staging.exists() {
        std::fs::remove_dir_all(&staging)
            .with_context(|| format!("removing stale import staging {}", staging.display()))?;
    }

    std::fs::create_dir_all(&staging)
        .with_context(|| format!("creating import staging {}", staging.display()))?;
    std::fs::copy(src, staging.join(names::SCREEN_VIDEO)).with_context(|| {
        format!("copying {} into the recording", src.display())
    })?;

    let writer = BundleWriter::create(&staging)?;
    writer.write_cursor_track(&CursorTrack::new(0))?;
    writer.write_meta(&RecordingMeta {
        version: RecordingMeta::CURRENT_VERSION,
        clock_epoch: 0,
        video_start_us: 0,
        display: DisplayInfo {
            width_px: width,
            height_px: height,
            scale_factor: 1.0,
            origin_x: 0.0,
            origin_y: 0.0,
        },
        duration_us,
        has_webcam: false,
        has_system_audio: false,
        has_mic_audio: false,
        fps,
    })?;

    pack_recording(&staging, &dol_path)?;
    std::fs::remove_dir_all(&staging)
        .with_context(|| format!("removing import staging {}", staging.display()))?;

    Ok(dol_path)
}

struct VideoMetadata {
    width: u32,
    height: u32,
    duration_us: u64,
    fps: u32,
}

/// Reads resolution, duration, and frame rate from a video file via
/// `AVURLAsset`. `naturalSize` is the track's untransformed dimensions, so
/// `preferredTransform` is applied to get the *displayed* orientation right
/// for rotated (e.g. phone) videos.
fn read_video_metadata(path: &Path) -> Result<VideoMetadata> {
    let url = NSURL::from_file_path(path)
        .ok_or_else(|| anyhow!("invalid file path: {}", path.display()))?;

    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&url, None) };

    let media_type = unsafe { AVMediaTypeVideo }.ok_or_else(|| anyhow!("AVMediaTypeVideo unavailable"))?;
    // `tracksWithMediaType:` is deprecated in favor of the async
    // `loadTracksWithMediaType:completionHandler:` — fine to keep the
    // synchronous variant here, where the import already blocks on copying
    // the whole file anyway and there's no UI to keep responsive.
    #[allow(deprecated)]
    let tracks = unsafe { asset.tracksWithMediaType(media_type) };
    let track = tracks
        .firstObject()
        .ok_or_else(|| anyhow!("{} has no video track", path.display()))?;

    let natural = unsafe { track.naturalSize() };
    let t = unsafe { track.preferredTransform() };
    // Apply the preferred transform to the natural size: for an untransformed
    // track (a/b/c/d = identity) this is `naturalSize` unchanged; a 90°-rotated
    // phone clip's transform swaps width/height back to the display orientation.
    let width = (t.a.abs() * natural.width + t.b.abs() * natural.height).round() as u32;
    let height = (t.c.abs() * natural.width + t.d.abs() * natural.height).round() as u32;
    if width == 0 || height == 0 {
        bail!("could not determine {}'s resolution", path.display());
    }

    let raw_fps = unsafe { track.nominalFrameRate() };
    let fps = if raw_fps.is_finite() && raw_fps >= 1.0 {
        raw_fps.round() as u32
    } else {
        30
    };

    let duration = unsafe { asset.duration() };
    let duration_us = if duration.flags.contains(CMTimeFlags::Valid) && duration.timescale > 0 {
        ((duration.value as f64 / duration.timescale as f64) * 1_000_000.0).round() as u64
    } else {
        0
    };

    Ok(VideoMetadata {
        width,
        height,
        duration_us,
        fps,
    })
}

/// Base display name for an import — the source file's stem, with non-file
/// characters scrubbed to keep the resulting path filesystem-friendly.
fn import_name(src: &Path) -> String {
    src.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| {
            let cleaned: String = s
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || c.is_whitespace() || c == '-' { c } else { ' ' })
                .collect();
            cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Imported video".to_string())
}

/// First free `{name}.dol` / `{name} N.dol` in `dir` — imports with the same
/// stem as an existing recording (or a previous import) get a numeric suffix
/// rather than clobbering it.
fn unique_name(dir: &Path, base: &str) -> String {
    for i in 0.. {
        let candidate = if i == 0 { base.to_string() } else { format!("{base} {i}") };
        if !dir.join(format!("{candidate}.dol")).exists() {
            return candidate;
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::CapturedFrame;
    use crate::encode::MovWriter;
    use crate::fs::BundleReader;

    fn frame_at(t_us: u64, width: u32, height: u32) -> CapturedFrame {
        CapturedFrame {
            t: t_us,
            width,
            height,
            bgra: vec![0u8; (width * height * 4) as usize],
        }
    }

    /// Writes a real 320x240 H.264 QuickTime movie, ~30fps for 1s, using the
    /// same `AVAssetWriter` path the recorder itself uses — so the import
    /// test exercises `read_video_metadata` against genuine encoded media.
    fn sample_video(path: &Path) {
        let width = 320u32;
        let height = 240u32;
        let mut writer = MovWriter::create(path, width, height).unwrap();
        for i in 0..30 {
            writer.append(&frame_at(i * 33_333, width, height)).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn imports_a_video_into_a_round_trippable_dol() {
        let video = tempfile::tempdir().unwrap();
        let video_path = video.path().join("clip.mp4");
        sample_video(&video_path);

        let cache = tempfile::tempdir().unwrap();
        let recordings = tempfile::tempdir().unwrap();

        let dol = import_video_into(
            cache.path(),
            recordings.path(),
            video_path.to_str().unwrap(),
        )
        .unwrap();

        assert!(dol.is_file(), "bundle written at {}", dol.display());
        assert!(dol.file_name().unwrap().to_string_lossy().starts_with("clip"));

        let reader = BundleReader::open(&dol).unwrap();
        assert!(reader.is_packed());

        let meta = reader.read_meta().unwrap();
        assert_eq!(meta.display.width_px, 320);
        assert_eq!(meta.display.height_px, 240);
        assert!(!meta.has_webcam, "an imported video has no webcam track");
        assert!(!meta.has_system_audio, "an imported video has no system audio");
        assert!(!meta.has_mic_audio, "an imported video has no mic track");
        assert_eq!(meta.video_start_us, 0, "the whole file is video, nothing before it");
        assert_eq!(meta.clock_epoch, 0, "imports have no shared recording clock");
        assert!(
            (900_000..1_100_000).contains(&meta.duration_us),
            "expected ~1s duration, got {}us",
            meta.duration_us
        );
        assert!(
            (25..=35).contains(&meta.fps),
            "expected ~30fps, got {}",
            meta.fps
        );

        assert!(
            reader.read_cursor_track().unwrap().samples.is_empty(),
            "imported bundles carry an empty cursor track"
        );
        assert!(reader.read_project().is_none(), "never-edited import has no project");
        assert!(
            reader.screen_video_url().starts_with("dol://"),
            "packed imports must be served over dol://, got {}",
            reader.screen_video_url()
        );
    }

    #[test]
    fn reimporting_the_same_file_gets_a_numeric_suffix() {
        let video = tempfile::tempdir().unwrap();
        let video_path = video.path().join("clip.mp4");
        sample_video(&video_path);

        let cache = tempfile::tempdir().unwrap();
        let recordings = tempfile::tempdir().unwrap();

        let first =
            import_video_into(cache.path(), recordings.path(), video_path.to_str().unwrap()).unwrap();
        let second =
            import_video_into(cache.path(), recordings.path(), video_path.to_str().unwrap()).unwrap();

        assert_ne!(first, second, "a re-import must not clobber the first bundle");
        assert!(
            first.file_name().unwrap().to_string_lossy().starts_with("clip"),
            "got {}",
            first.display()
        );
        assert!(
            second.file_name().unwrap().to_string_lossy().starts_with("clip 1"),
            "got {}",
            second.display()
        );
    }
}
