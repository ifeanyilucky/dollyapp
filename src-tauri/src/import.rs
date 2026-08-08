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
use objc2_avf::rc::Retained;
use objc2_core_media::CMTimeFlags;
use objc2_foundation_avf::{NSURL, NSString};
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

    let base = projects::recordings_dir(app)?;
    std::fs::create_dir_all(&base)
        .with_context(|| format!("creating {}", base.display()))?;
    let name = unique_name(&base, import_name(src));
    let dol_path = base.join(format!("{name}.dol"));

    // Stage as a loose `.motionrec` dir (the same shape a real recording's
    // staging dir is), then pack it to `.dol` and drop the staging dir.
    let cache = app
        .path()
        .app_cache_dir()
        .context("could not resolve the app cache directory")?;
    let staging = cache
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
    let path_str = path.to_str().ok_or_else(|| anyhow!("non-UTF-8 path"))?;
    let ns_path = NSString::from_str(path_str);
    let url = NSURL::from_file_path(&ns_path)
        .ok_or_else(|| anyhow!("invalid file path: {}", path.display()))?;

    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&url, None) };

    let media_type = unsafe { AVMediaTypeVideo }.ok_or_else(|| anyhow!("AVMediaTypeVideo unavailable"))?;
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
