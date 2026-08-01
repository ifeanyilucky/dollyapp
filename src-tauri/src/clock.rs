//! The one clock that both the video and cursor pipelines must read from.
//!
//! Non-negotiable per ARCHITECTURE.md: mixing `Date.now()`/`Instant::now()`
//! on one stream with a video PTS on the other causes drift that compounds
//! over a recording. Everything that timestamps a capture event goes
//! through `Clock`, seeded once from `mach_absolute_time` when the first
//! video frame lands.

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::OnceLock;

    /// Cached `mach_timebase_info`, converting host ticks to nanoseconds.
    /// On Apple Silicon this is 1/1 but it's not guaranteed by the ABI, so
    /// we read it rather than assume.
    fn timebase() -> &'static mach2::mach_time::mach_timebase_info {
        static TIMEBASE: OnceLock<mach2::mach_time::mach_timebase_info> = OnceLock::new();
        TIMEBASE.get_or_init(|| {
            let mut info = mach2::mach_time::mach_timebase_info { numer: 0, denom: 0 };
            unsafe {
                mach2::mach_time::mach_timebase_info(&mut info);
            }
            info
        })
    }

    /// Raw `mach_absolute_time()`, in host ticks. Use `now_us` for anything
    /// that ends up in a bundle — ticks are not portable across machines,
    /// microseconds since an epoch we control are.
    pub fn raw_ticks() -> u64 {
        unsafe { mach2::mach_time::mach_absolute_time() }
    }

    pub fn ticks_to_us(ticks: u64) -> u64 {
        let tb = timebase();
        // ticks * numer / denom = nanoseconds; divide by 1000 for microseconds.
        // u128 avoids overflow on long recordings at nanosecond precision.
        (((ticks as u128) * (tb.numer as u128)) / (tb.denom as u128) / 1000) as u64
    }
}

#[cfg(target_os = "macos")]
pub use macos::{raw_ticks, ticks_to_us};

/// A recording's shared clock. Created once, at the moment the first video
/// frame is captured; every subsequent timestamp — cursor samples, clicks,
/// keys — is `Clock::now_us()` relative to that same instant.
#[derive(Debug, Clone, Copy)]
pub struct Clock {
    epoch_us: u64,
}

impl Clock {
    /// Starts a new clock "now". `epoch_us()` is the value to persist as
    /// `RecordingMeta::clock_epoch`.
    #[cfg(target_os = "macos")]
    pub fn start() -> Self {
        Self { epoch_us: ticks_to_us(raw_ticks()) }
    }

    pub fn epoch_us(&self) -> u64 {
        self.epoch_us
    }

    /// Microseconds elapsed since this clock started. This is what gets
    /// written as `t` in `cursor.json`.
    #[cfg(target_os = "macos")]
    pub fn now_us(&self) -> u64 {
        ticks_to_us(raw_ticks()).saturating_sub(self.epoch_us)
    }
}
