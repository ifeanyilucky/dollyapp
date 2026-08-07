use std::io::BufWriter;
use std::mem::size_of;
use std::path::PathBuf;
use std::ptr::{self, NonNull};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use block2_avf::RcBlock;
use dispatch2::DispatchQueue;
use objc2_avf::rc::Retained;
use objc2_avf::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2_avf::{define_class, msg_send, AnyThread};
use objc2_core_audio_types::{kAudioFormatFlagIsNonInterleaved, AudioBufferList};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{
    kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
    CMAudioFormatDescriptionGetStreamBasicDescription, CMBlockBuffer, CMSampleBuffer,
};
use objc2_foundation_avf::{NSArray, NSError};
use objc2_screen_capture_kit::{
    SCContentFilter, SCStream, SCStreamConfiguration, SCStreamOutput, SCStreamOutputType,
    SCShareableContent,
};

/// System audio is delivered by `SCStream` in the exact format we ask for in
/// `SCStreamConfiguration` — float32 at this rate/count, regardless of the
/// mix of sources (apps, alerts, device output) being captured.
const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: usize = 2;

/// Runs an `SCStream` whose audio output is written to a WAV file, on its own
/// dedicated thread for the recording's lifetime — the same shape as
/// `MicRecorder` (`audio::macos`), and for the same reason: the ScreenCaptureKit
/// callbacks run on a dispatch queue we give SCK, never on the main thread,
/// so a self-contained worker thread (create, use, tear down, all here) is
/// enough.
///
/// Unlike the mic, system audio needs no extra permission: it rides on the
/// Screen Recording grant the video capture already required. The stream is
/// still *audio-only* (we only register an `SCStreamOutput` of type `.Audio`;
/// the video SCK captures internally is simply never read).
pub struct SystemAudioRecorder {
    stop_tx: mpsc::Sender<()>,
    thread: Option<JoinHandle<Result<()>>>,
}

impl SystemAudioRecorder {
    pub fn start(wav_path: PathBuf) -> Result<Self> {
        let (stop_tx, stop_rx) = mpsc::channel();
        let thread = std::thread::Builder::new()
            .name("dolly-system-audio".into())
            .spawn(move || run(wav_path, stop_rx))
            .context("failed to spawn system audio capture thread")?;
        Ok(Self {
            stop_tx,
            thread: Some(thread),
        })
    }

    pub fn stop(mut self) -> Result<()> {
        // Send is best-effort: if the capture thread already exited (e.g.
        // SCK setup failed — most likely Screen Recording permission was
        // revoked mid-recording), there's nothing listening, and `join`
        // below still surfaces that failure.
        let _ = self.stop_tx.send(());
        self.thread
            .take()
            .expect("thread is always Some until stop() consumes self")
            .join()
            .map_err(|_| anyhow!("system audio capture thread panicked"))?
    }
}

/// Shared with the `SCStreamOutput` delegate (which runs on SCK's dispatch
/// queue): the delegate writes into it, the worker thread finalizes it.
#[derive(Clone)]
struct AudioSink {
    writer: Arc<Mutex<hound::WavWriter<BufWriter<std::fs::File>>>>,
}

struct AudioOutputIvars {
    sink: AudioSink,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "DollySystemAudioOutput"]
    #[ivars = AudioOutputIvars]
    struct AudioOutput;

    unsafe impl NSObjectProtocol for AudioOutput {}

    unsafe impl SCStreamOutput for AudioOutput {
        #[optional]
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        unsafe fn stream_didOutputSampleBuffer_ofType(
            &self,
            _stream: &SCStream,
            sample_buffer: &CMSampleBuffer,
            kind: SCStreamOutputType,
        ) {
            if kind == SCStreamOutputType::Audio {
                handle_sample(&self.ivars().sink, sample_buffer);
            }
        }
    }
);

impl AudioOutput {
    fn new(sink: AudioSink) -> Retained<AudioOutput> {
        let this = AudioOutput::alloc().set_ivars(AudioOutputIvars { sink });
        unsafe { msg_send![super(&this), init] }
    }
}

/// Copies one audio sample buffer into the shared WAV writer, interleaving
/// the planar (non-interleaved) buffers SCK delivers.
///
/// `sample_buffer`'s data lives in the retained `CMBlockBuffer` handed back
/// by `CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer`, which we
/// keep alive (via `CFRetained`) until the copy is done.
fn handle_sample(sink: &AudioSink, sample_buffer: &CMSampleBuffer) {
    // SCK delivers at the sample rate / channel count we configured. Refuse
    // anything else — a mismatch would silently corrupt the WAV header we
    // already wrote, and dropped buffers are preferable.
    let Some(format_desc) = (unsafe { sample_buffer.format_description() }) else {
        return;
    };
    let asbd = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(&*format_desc) };
    if asbd.is_null() {
        return;
    }
    let asbd = unsafe { &*asbd };
    if asbd.mBitsPerChannel != 32
        || asbd.mSampleRate as u32 != SAMPLE_RATE
        || asbd.mChannelsPerFrame as usize != CHANNELS
    {
        return;
    }
    let non_interleaved = asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0;

    // Two-pass `CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer`:
    // the first call (NULL output) reports how big the AudioBufferList is,
    // the second fills it in.
    let mut block_buffer: *mut CMBlockBuffer = ptr::null_mut();
    let mut buffer_list_size = 0usize;
    let status = unsafe {
        sample_buffer.audio_buffer_list_with_retained_block_buffer(
            &mut buffer_list_size,
            ptr::null_mut(),
            0,
            None,
            None,
            kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            ptr::null_mut(),
        )
    };
    if status != 0 || buffer_list_size == 0 {
        return;
    }
    let mut bytes = vec![0u8; buffer_list_size];
    let status = unsafe {
        sample_buffer.audio_buffer_list_with_retained_block_buffer(
            &mut buffer_list_size,
            bytes.as_mut_ptr().cast(),
            buffer_list_size,
            None,
            None,
            kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            &mut block_buffer,
        )
    };
    if status != 0 || block_buffer.is_null() {
        return;
    }
    // The block buffer owns the sample memory — hold it until the copies
    // below finish; dropping the `CFRetained` releases it.
    let _keep_alive = unsafe { CFRetained::from_raw(NonNull::new_unchecked(block_buffer)) };

    let list = unsafe { &*bytes.as_ptr().cast::<AudioBufferList>() };
    let buffers = &list.mBuffers[..list.mNumberBuffers as usize];
    let Ok(mut writer) = sink.writer.lock() else {
        return;
    };

    if non_interleaved {
        // One AudioBuffer per channel, `mDataByteSize` bytes of f32 each.
        let num_frames = buffers
            .first()
            .map_or(0, |b| b.mDataByteSize as usize / size_of::<f32>());
        for frame in 0..num_frames {
            for buffer in buffers.iter().take(CHANNELS) {
                let data = buffer.mData.cast::<f32>();
                if data.is_null() {
                    return;
                }
                let sample = unsafe { *data.add(frame) };
                let _ = writer.write_sample(sample);
            }
        }
    } else if let Some(buffer) = buffers.first() {
        // Interleaved: a single AudioBuffer holds all channels.
        let data = buffer.mData.cast::<f32>();
        if !data.is_null() {
            let total = buffer.mDataByteSize as usize / size_of::<f32>();
            for i in 0..total {
                let sample = unsafe { *data.add(i) };
                let _ = writer.write_sample(sample);
            }
        }
    }
}

fn run(wav_path: PathBuf, stop_rx: mpsc::Receiver<()>) -> Result<()> {
    let content = fetch_shareable_content()?;
    let display = content
        .displays()
        .firstObject()
        .ok_or_else(|| anyhow!("no displays available for system audio capture"))?;

    // System audio is a property of the whole machine, not of any one
    // display — the filter only needs *some* display as the content source.
    let filter = unsafe {
        SCContentFilter::initWithDisplay_excludingWindows(
            SCContentFilter::alloc(),
            &display,
            &NSArray::new(),
        )
    };
    let config = unsafe { SCStreamConfiguration::new() };
    unsafe {
        config.setCapturesAudio(true);
        config.setSampleRate(SAMPLE_RATE as _);
        config.setChannelCount(CHANNELS as _);
    }
    let stream = unsafe {
        SCStream::initWithFilter_configuration_delegate(SCStream::alloc(), &filter, &config, None)
    };

    let spec = hound::WavSpec {
        channels: CHANNELS as u16,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let writer = Arc::new(Mutex::new(
        hound::WavWriter::create(&wav_path, spec).context("creating system.wav")?,
    ));
    let sink = AudioSink { writer };

    let output = AudioOutput::new(sink.clone());
    let queue = DispatchQueue::new("dolly.system-audio", None);
    let output_proto: &ProtocolObject<dyn SCStreamOutput> = ProtocolObject::from_ref(&output);
    unsafe {
        stream
            .addStreamOutput_type_sampleHandlerQueue_error(
                output_proto,
                SCStreamOutputType::Audio,
                Some(&queue),
            )
            .context("adding audio stream output")?;
    }

    // `startCapture` reports success/failure asynchronously — wait for it so
    // a failure (e.g. Screen Recording permission revoked) surfaces as a real
    // error from this thread (and hence from `stop()`) rather than as a
    // silent, empty system.wav.
    let (start_tx, start_rx) = mpsc::channel();
    let start_block = RcBlock::new(move |err: *mut NSError| {
        let _ = start_tx.send(err.is_null());
    });
    unsafe { stream.startCaptureWithCompletionHandler(Some(&start_block)) };
    let started = start_rx
        .recv_timeout(Duration::from_secs(5))
        .context("timed out waiting for system audio capture to start")?;
    if !started {
        return Err(anyhow!("failed to start system audio capture"));
    }

    // Blocks this thread until `stop()` sends — the sample handler above runs
    // independently on `queue` in the meantime.
    let _ = stop_rx.recv();

    // Stop, then wait for the stop to actually complete, then drain the
    // sample queue: once the drain closure below runs, every audio callback
    // enqueued before it has finished, so nobody is mid-write when we
    // finalize the WAV below.
    let (stop_tx, stop_rx) = mpsc::channel();
    let stop_block = RcBlock::new(move |_err: *mut NSError| {
        let _ = stop_tx.send(());
    });
    unsafe { stream.stopCaptureWithCompletionHandler(Some(&stop_block)) };
    let _ = stop_rx.recv_timeout(Duration::from_secs(5));
    queue.exec_sync(|| {});

    drop(output);
    drop(queue);
    drop(stream);

    Arc::try_unwrap(sink.writer)
        .map_err(|_| anyhow!("system audio writer still referenced after stopping"))?
        .into_inner()
        .map_err(|_| anyhow!("system audio writer mutex was poisoned"))?
        .finalize()
        .context("finalizing system.wav")?;

    Ok(())
}

/// Fetches the list of capturable displays, blocking until SCK's async
/// completion handler fires (or a timeout elapses).
fn fetch_shareable_content() -> Result<Retained<SCShareableContent>> {
    let (tx, rx) = mpsc::channel();
    // SCK hands the completion handler an owned (+1) content object — wrap
    // it so it's released when the `Retained` is dropped.
    let block = RcBlock::new(move |content: *mut SCShareableContent, _err: *mut NSError| {
        let _ = tx.send(unsafe { Retained::from_raw(content) });
    });
    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&block) };
    rx.recv_timeout(Duration::from_secs(5))
        .context("timed out waiting for shareable content")?
        .ok_or_else(|| anyhow!("failed to fetch shareable content"))
}
