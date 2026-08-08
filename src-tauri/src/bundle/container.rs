//! Packs a finished recording's staging directory into one `.dol` file —
//! the write-side counterpart to `fs::BundleReader`'s zip-reading branch
//! and `dol_protocol`'s byte-range serving.
//!
//! `meta.json`/`cursor.json` are small and always read whole, so they're
//! DEFLATE-compressed for size. `screen.mov`/`mic.wav` are stored
//! (`CompressionMethod::Stored`, i.e. uncompressed) instead: video/audio is
//! already compressed at the codec level, and — more importantly — a
//! Stored entry's bytes sit contiguously in the archive starting at a
//! fixed, queryable offset (`ZipFile::data_start`), which is what lets
//! `dol_protocol` seek directly into the `.dol` file and serve an
//! HTTP `Range` request without ever decompressing anything.

use std::fs::File;
use std::io;
use std::path::Path;

use anyhow::{Context, Result};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::names;

/// `screen.mov`/`mic.wav` can each be many gigabytes at 60 FPS — Zip's
/// original 32-bit size fields overflow past 4 GiB, so entries that might
/// exceed that need `large_file(true)` (the Zip64 extension) set up front,
/// or writing silently fails partway through on anything long enough to
/// hit the limit. Small JSON entries never need this.
fn media_file_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(true)
}

/// Streams one file at `src` into `writer` as an entry named `name` — never
/// buffers the whole (potentially multi-gigabyte) file in memory, unlike
/// `serde_json::to_vec`-then-write for the small JSON entries below.
fn add_file_entry(
    writer: &mut ZipWriter<File>,
    src: &Path,
    name: &str,
    options: SimpleFileOptions,
) -> Result<()> {
    writer
        .start_file(name, options)
        .with_context(|| format!("starting zip entry {name}"))?;
    let mut src_file = File::open(src).with_context(|| format!("opening {}", src.display()))?;
    io::copy(&mut src_file, writer).with_context(|| format!("writing zip entry {name}"))?;
    Ok(())
}

/// Packs `staging_dir` (a recording's plain-directory staging area — see
/// the module doc comment) into a single `.dol` file at `dest`. `dest`'s
/// parent directory must already exist (it's `~/Movies/Dolly`, created
/// once at first launch — see `projects::recordings_dir`). `staging_dir`
/// itself is left untouched; the caller (`recorder::macos::stop`) removes
/// it only after this returns successfully, so a failure here never loses
/// the just-finished recording.
///
/// `mic.wav` is optional (mirrors `RecordingMeta.has_mic_audio` — mic
/// capture might not have been enabled, or might have failed to start);
/// every other entry is required.
pub fn pack_recording(staging_dir: &Path, dest: &Path) -> Result<()> {
    let file = File::create(dest).with_context(|| format!("creating {}", dest.display()))?;
    let mut writer = ZipWriter::new(file);

    for name in [names::META, names::CURSOR] {
        add_file_entry(
            &mut writer,
            &staging_dir.join(name),
            name,
            SimpleFileOptions::default(),
        )?;
    }

    add_file_entry(
        &mut writer,
        &staging_dir.join(names::SCREEN_VIDEO),
        names::SCREEN_VIDEO,
        media_file_options(),
    )?;

    let mic_path = staging_dir.join(names::MIC_AUDIO);
    if mic_path.exists() {
        add_file_entry(&mut writer, &mic_path, names::MIC_AUDIO, media_file_options())?;
    }

    let system_audio_path = staging_dir.join(names::SYSTEM_AUDIO);
    if system_audio_path.exists() {
        add_file_entry(
            &mut writer,
            &system_audio_path,
            names::SYSTEM_AUDIO,
            media_file_options(),
        )?;
    }

    writer
        .finish()
        .with_context(|| format!("finishing zip archive at {}", dest.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn packs_and_reads_back_stored_and_deflated_entries() {
        let staging = tempfile::tempdir().unwrap();
        std::fs::write(staging.path().join(names::META), b"{\"hello\":true}").unwrap();
        std::fs::write(staging.path().join(names::CURSOR), b"{\"samples\":[]}").unwrap();
        std::fs::write(staging.path().join(names::SCREEN_VIDEO), b"fake-video-bytes").unwrap();
        // No mic.wav — exercises the "optional entry" path.

        let dest_dir = tempfile::tempdir().unwrap();
        let dest = dest_dir.path().join("Recording 1.dol");
        pack_recording(staging.path(), &dest).unwrap();

        let file = File::open(&dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();

        let mut meta_bytes = Vec::new();
        archive.by_name(names::META).unwrap().read_to_end(&mut meta_bytes).unwrap();
        assert_eq!(meta_bytes, b"{\"hello\":true}");

        let mut video = archive.by_name(names::SCREEN_VIDEO).unwrap();
        assert_eq!(video.compression(), CompressionMethod::Stored);
        let mut video_bytes = Vec::new();
        video.read_to_end(&mut video_bytes).unwrap();
        assert_eq!(video_bytes, b"fake-video-bytes");
        drop(video);

        assert!(archive.by_name(names::MIC_AUDIO).is_err());
    }
}
