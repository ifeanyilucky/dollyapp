use std::path::PathBuf;
use std::ptr::NonNull;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use anyhow::{anyhow, Context, Result};
use objc2_avf_audio::{AVAudioEngine, AVAudioPCMBuffer, AVAudioTime};

/// Runs `AVAudioEngine` on its own dedicated thread for the recording's
/// lifetime. Unlike the cursor `NSEvent` monitor, this doesn't need to be
/// pinned to the app's main thread — the tap block fires on a Core Audio
/// thread regardless of where the engine was created — so a self-contained
/// worker thread (create, use, tear down, all here) is enough; no
/// `run_on_main_thread` dance needed.
pub struct MicRecorder {
    stop_tx: mpsc::Sender<()>,
    thread: Option<JoinHandle<Result<()>>>,
}

impl MicRecorder {
    pub fn start(wav_path: PathBuf) -> Result<Self> {
        let (stop_tx, stop_rx) = mpsc::channel();
        let thread = std::thread::Builder::new()
            .name("dolly-mic".into())
            .spawn(move || run(wav_path, stop_rx))
            .context("failed to spawn mic capture thread")?;
        Ok(Self { stop_tx, thread: Some(thread) })
    }

    pub fn stop(mut self) -> Result<()> {
        // Send is best-effort: if the capture thread already exited (e.g.
        // engine start failed), there's nothing listening, and `join`
        // below still surfaces that failure.
        let _ = self.stop_tx.send(());
        self.thread
            .take()
            .expect("thread is always Some until stop() consumes self")
            .join()
            .map_err(|_| anyhow!("mic capture thread panicked"))?
    }
}

fn run(wav_path: PathBuf, stop_rx: mpsc::Receiver<()>) -> Result<()> {
    let engine = unsafe { AVAudioEngine::new() };
    let input_node = unsafe { engine.inputNode() };
    let format = unsafe { input_node.outputFormatForBus(0) };

    let sample_rate = unsafe { format.sampleRate() };
    let channels = unsafe { format.channelCount() };
    if sample_rate <= 0.0 || channels == 0 {
        return Err(anyhow!(
            "mic input format unavailable (sample_rate={sample_rate}, channels={channels})"
        ));
    }

    let spec = hound::WavSpec {
        channels: channels as u16,
        sample_rate: sample_rate as u32,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let writer =
        Arc::new(Mutex::new(hound::WavWriter::create(&wav_path, spec).context("creating mic.wav")?));

    let tap_writer = Arc::clone(&writer);
    let channel_count = channels as usize;
    let tap_block = block2_avf::RcBlock::new(
        move |buf: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
            let buf = unsafe { buf.as_ref() };
            let frame_length = unsafe { buf.frameLength() } as usize;
            // Deinterleaved: one pointer per channel, each pointing to
            // `frame_length` contiguous f32 samples.
            let channel_data = unsafe { buf.floatChannelData() };
            if channel_data.is_null() || frame_length == 0 {
                return;
            }
            let Ok(mut writer) = tap_writer.lock() else { return };
            for frame in 0..frame_length {
                for ch in 0..channel_count {
                    let channel_ptr = unsafe { *channel_data.add(ch) };
                    let sample = unsafe { *channel_ptr.as_ptr().add(frame) };
                    let _ = writer.write_sample(sample);
                }
            }
        },
    );

    unsafe {
        input_node.installTapOnBus_bufferSize_format_block(
            0,
            4096,
            Some(&format),
            block2_avf::RcBlock::as_ptr(&tap_block),
        );
        engine.startAndReturnError().map_err(|e| anyhow!("failed to start AVAudioEngine: {e:?}"))?;
    }

    // Blocks this thread until `stop()` sends — the tap block above runs
    // independently on Core Audio's own thread in the meantime.
    let _ = stop_rx.recv();

    unsafe {
        input_node.removeTapOnBus(0);
        engine.stop();
    }
    // The tap is guaranteed gone by this point, but `tap_block`'s captured
    // `tap_writer` clone is still alive until this drop — needed so the
    // `Arc::try_unwrap` below actually succeeds.
    drop(tap_block);

    Arc::try_unwrap(writer)
        .map_err(|_| anyhow!("mic writer still referenced after stopping"))?
        .into_inner()
        .map_err(|_| anyhow!("mic writer mutex was poisoned"))?
        .finalize()
        .context("finalizing mic.wav")?;

    Ok(())
}
