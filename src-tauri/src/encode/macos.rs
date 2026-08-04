use std::ffi::c_void;
use std::path::Path;
use std::ptr::NonNull;

use anyhow::{anyhow, Result};
// `objc2_av_foundation`'s types are of the 0.6 objc2 generation, same as
// the `objc2-avf`/`block2-avf` aliases in permissions/macos.rs — the
// plain `objc2` dependency elsewhere in this crate is 0.5, a distinct
// (incompatible) `Retained`/`Message`.
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterInputPixelBufferAdaptor,
    AVAssetWriterStatus, AVFileTypeQuickTimeMovie, AVMediaTypeVideo, AVVideoCodecKey,
    AVVideoCodecTypeH264, AVVideoHeightKey, AVVideoWidthKey,
};
use objc2_avf::rc::Retained;
use objc2_avf::runtime::AnyObject;
use objc2_avf::Message as _;
use objc2_core_foundation::CFRetained;
use objc2_core_media::{CMTime, CMTimeFlags};
use objc2_core_video::{kCVPixelFormatType_32BGRA, kCVReturnSuccess, CVPixelBuffer};
use objc2_foundation_avf::{NSDictionary, NSNumber, NSString, NSURL};

use crate::capture::CapturedFrame;

/// Wraps `AVAssetWriter` + a pixel-buffer adaptor for one recording.
/// `append` takes `capture::CapturedFrame`s as-is (BGRA8) — see the module
/// doc comment for why no conversion is needed. Not `Send`: like the
/// cursor monitor, this holds `Retained`/`CFRetained` ObjC/CF objects, so
/// it's created, used, and torn down entirely on one dedicated thread
/// (the same `dolly-capture` thread that already owns `FrameGrabber`).
pub struct MovWriter {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor>,
    session_started: bool,
}

impl MovWriter {
    pub fn create(path: &Path, width: u32, height: u32) -> Result<Self> {
        // AVAssetWriter refuses to write over an existing file.
        let _ = std::fs::remove_file(path);

        let url = NSURL::from_file_path(path)
            .ok_or_else(|| anyhow!("invalid output path: {}", path.display()))?;
        let file_type = unsafe { AVFileTypeQuickTimeMovie }
            .ok_or_else(|| anyhow!("AVFileTypeQuickTimeMovie unavailable"))?;

        let writer = unsafe { AVAssetWriter::assetWriterWithURL_fileType_error(&url, file_type) }
            .map_err(|e| anyhow!("failed to create AVAssetWriter: {e:?}"))?;

        let settings = video_output_settings(width, height)?;
        let media_type =
            unsafe { AVMediaTypeVideo }.ok_or_else(|| anyhow!("AVMediaTypeVideo unavailable"))?;
        let input = unsafe {
            AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
                media_type,
                Some(&*settings),
            )
        };
        unsafe { input.setExpectsMediaDataInRealTime(true) };

        if !unsafe { writer.canAddInput(&input) } {
            return Err(anyhow!(
                "AVAssetWriter cannot accept a video input with these settings"
            ));
        }
        unsafe { writer.addInput(&input) };

        let adaptor = unsafe {
            AVAssetWriterInputPixelBufferAdaptor::assetWriterInputPixelBufferAdaptorWithAssetWriterInput_sourcePixelBufferAttributes(&input, None)
        };

        if !unsafe { writer.startWriting() } {
            let err = unsafe { writer.error() };
            return Err(anyhow!("AVAssetWriter failed to start writing: {err:?}"));
        }

        Ok(Self {
            writer,
            input,
            adaptor,
            session_started: false,
        })
    }

    /// `frame.t` (microseconds since the recording's shared `Clock` epoch —
    /// see ARCHITECTURE.md, "Recording format") is used directly as the
    /// presentation time, so `screen.mov`'s own timestamps stay on the
    /// exact same clock as `cursor.json`.
    pub fn append(&mut self, frame: &CapturedFrame) -> Result<()> {
        if !self.session_started {
            unsafe { self.writer.startSessionAtSourceTime(cm_time_us(frame.t)) };
            self.session_started = true;
        }

        // Encoding should comfortably keep up with 60fps; this is a safety
        // valve, not the expected steady state. Still bounded — a wedged
        // encoder (backpressure that never clears) must surface as an error,
        // not freeze the capture thread in a loop forever.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !unsafe { self.input.isReadyForMoreMediaData() } {
            if std::time::Instant::now() > deadline {
                let err = unsafe { self.writer.error() };
                return Err(anyhow!(
                    "timed out waiting for the encoder to drain: {err:?}"
                ));
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }

        let pixel_buffer = pixel_buffer_from_frame(frame)?;
        let pts = cm_time_us(frame.t);
        if !unsafe {
            self.adaptor
                .appendPixelBuffer_withPresentationTime(&pixel_buffer, pts)
        } {
            let err = unsafe { self.writer.error() };
            return Err(anyhow!("failed to append frame at t={}: {err:?}", frame.t));
        }
        Ok(())
    }

    pub fn finish(self) -> Result<()> {
        unsafe { self.input.markAsFinished() };

        // The deprecated synchronous `finishWriting` can block indefinitely
        // if the encoder wedges; instead call the completion-handler variant
        // and wait on a one-shot channel with a deadline. The handler is
        // invoked exactly once when writing finishes (or fails) — an mpsc
        // channel is a clean rendezvous and needs no extra bridging, unlike
        // the discarded block param of the old API.
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let handler = block2_avf::RcBlock::new(move || {
            let _ = done_tx.send(());
        });
        unsafe { self.writer.finishWritingWithCompletionHandler(&handler) };

        // The handler fires on an AVFoundation internal queue; `recv_timeout`
        // wakes on completion or on the deadline, so a wedged encoder can't
        // hang the capture thread (and therefore the recording) forever.
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        match done_rx.recv_timeout(remaining) {
            Ok(()) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                let err = unsafe { self.writer.error() };
                return Err(anyhow!("timed out finishing screen.mov: {err:?}"));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err(anyhow!("finish callback dropped without firing"));
            }
        }

        // A failed writer still calls the completion handler, so success is
        // determined from `status`, not from the handler firing.
        if unsafe { self.writer.status() } != AVAssetWriterStatus::Completed {
            let err = unsafe { self.writer.error() };
            return Err(anyhow!("failed to finish writing screen.mov: {err:?}"));
        }
        Ok(())
    }
}

/// `t_us`: microseconds since the recording's `Clock` epoch — the same
/// unit `frame.t` and `cursor.json` timestamps already use, so this is a
/// direct 1:1 mapping, not a rescale.
fn cm_time_us(t_us: u64) -> CMTime {
    CMTime {
        value: t_us as i64,
        timescale: 1_000_000,
        flags: CMTimeFlags::Valid,
        epoch: 0,
    }
}

fn video_output_settings(
    width: u32,
    height: u32,
) -> Result<Retained<NSDictionary<NSString, AnyObject>>> {
    let codec_key =
        unsafe { AVVideoCodecKey }.ok_or_else(|| anyhow!("AVVideoCodecKey unavailable"))?;
    let codec_h264 = unsafe { AVVideoCodecTypeH264 }
        .ok_or_else(|| anyhow!("AVVideoCodecTypeH264 unavailable"))?;
    let width_key =
        unsafe { AVVideoWidthKey }.ok_or_else(|| anyhow!("AVVideoWidthKey unavailable"))?;
    let height_key =
        unsafe { AVVideoHeightKey }.ok_or_else(|| anyhow!("AVVideoHeightKey unavailable"))?;

    // AVVideoCodecType/NSString and NSNumber don't share a concrete Rust
    // type, but `NSDictionary`'s value slot needs one — `cast_unchecked`
    // to `AnyObject` is objc2's sanctioned upcast for exactly this (every
    // `Message`-implementing type shares the same underlying
    // representation as `AnyObject`).
    let codec_value: Retained<AnyObject> = unsafe { Retained::cast_unchecked(codec_h264.retain()) };
    let width_value: Retained<AnyObject> =
        unsafe { Retained::cast_unchecked(NSNumber::new_u32(width)) };
    let height_value: Retained<AnyObject> =
        unsafe { Retained::cast_unchecked(NSNumber::new_u32(height)) };

    Ok(NSDictionary::from_retained_objects(
        &[codec_key, width_key, height_key],
        &[codec_value, width_value, height_value],
    ))
}

fn pixel_buffer_from_frame(frame: &CapturedFrame) -> Result<CFRetained<CVPixelBuffer>> {
    let bytes_per_row = frame.width as usize * 4;
    // scap already strips row padding when it copies frames out of the
    // underlying CVPixelBuffer (verified against its source), so this
    // tight-packed assumption holds — see capture/macos.rs's doc comment
    // on `CapturedFrame::bgra`.
    if frame.bgra.len() != bytes_per_row * frame.height as usize {
        return Err(anyhow!(
            "unexpected BGRA buffer size: {} bytes for {}x{}",
            frame.bgra.len(),
            frame.width,
            frame.height
        ));
    }

    // Boxing the Vec (not the slice) keeps the pointer round-trip through
    // the C callback thin — `Box<[u8]>::into_raw` is a fat pointer and
    // can't be reconstructed from the single pointer CoreVideo hands back.
    let boxed = Box::new(frame.bgra.clone());
    let base_address = boxed.as_ptr() as *mut c_void;
    let release_ref_con = Box::into_raw(boxed) as *mut c_void;

    let mut pixel_buffer_ptr: *mut CVPixelBuffer = std::ptr::null_mut();
    let status = unsafe {
        objc2_core_video::CVPixelBufferCreateWithBytes(
            objc2_core_foundation::kCFAllocatorDefault,
            frame.width as usize,
            frame.height as usize,
            kCVPixelFormatType_32BGRA,
            NonNull::new(base_address).ok_or_else(|| anyhow!("empty frame buffer"))?,
            bytes_per_row,
            Some(release_bgra_bytes),
            release_ref_con,
            None,
            NonNull::from(&mut pixel_buffer_ptr),
        )
    };

    if status != kCVReturnSuccess {
        tracing::error!(
            "CVPixelBufferCreateWithBytes args: width={} height={} bytes_per_row={} buf_len={} base_address_null={}",
            frame.width,
            frame.height,
            bytes_per_row,
            frame.bgra.len(),
            base_address.is_null(),
        );
        // Creation failed before CoreVideo took ownership — free it
        // ourselves instead of leaking, since `release_bgra_bytes` will
        // never be called for a buffer that was never created.
        drop(unsafe { Box::from_raw(release_ref_con as *mut Vec<u8>) });
        return Err(anyhow!("CVPixelBufferCreateWithBytes failed: {status}"));
    }

    let ptr = NonNull::new(pixel_buffer_ptr).ok_or_else(|| {
        anyhow!("CVPixelBufferCreateWithBytes succeeded but returned a null buffer")
    })?;
    Ok(unsafe { CFRetained::from_raw(ptr) })
}

unsafe extern "C-unwind" fn release_bgra_bytes(
    release_ref_con: *mut c_void,
    _base_address: *const c_void,
) {
    if !release_ref_con.is_null() {
        drop(unsafe { Box::from_raw(release_ref_con as *mut Vec<u8>) });
    }
}
