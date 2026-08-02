import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  discardRecording,
  getRecordingStatus,
  pauseRecording,
  RECORDING_STATE_EVENT,
  resumeRecording,
  startRecording,
  stopRecording,
} from "./api";

/**
 * Mirrors recording state from the Rust side, which is the source of
 * truth — recording can also be toggled from the tray menu or the global
 * shortcut (`⌥⌘2`), not just this UI, so this listens for
 * `recording-state-changed` rather than only tracking its own button
 * clicks.
 */
export function useRecordingState(onFinished?: (bundlePath: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRecordingPath, setLastRecordingPath] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  // `accumulatedMsRef` banks the ms racked up before the *current* unpaused
  // run (i.e. across previous pause/resume cycles of this same
  // recording); `runStartRef` is when the current unpaused run began, or
  // `null` while paused/stopped. Refs rather than state since they're
  // read every 200ms tick without needing a re-render themselves.
  const accumulatedMsRef = useRef(0);
  const runStartRef = useRef<number | null>(null);

  useEffect(() => {
    void getRecordingStatus().then(setIsRecording);

    const unlisten = listen<boolean>(RECORDING_STATE_EVENT, (event) => {
      setIsRecording(event.payload);
      setIsPaused(false);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Ticks `elapsedMs` while actually recording and not paused; frozen at
  // its last value during a pause, reset to 0 the moment recording stops
  // (including a discard/restart) so the *next* recording always starts
  // its own clock at 0:00 rather than carrying over the discarded one's.
  useEffect(() => {
    if (!isRecording) {
      accumulatedMsRef.current = 0;
      runStartRef.current = null;
      setElapsedMs(0);
      return;
    }
    if (isPaused) {
      runStartRef.current = null;
      setElapsedMs(accumulatedMsRef.current);
      return;
    }

    runStartRef.current = Date.now();
    const startedAccumulated = accumulatedMsRef.current;
    const interval = window.setInterval(() => {
      setElapsedMs(startedAccumulated + (Date.now() - (runStartRef.current ?? Date.now())));
    }, 200);
    return () => {
      window.clearInterval(interval);
      if (runStartRef.current !== null) {
        accumulatedMsRef.current += Date.now() - runStartRef.current;
      }
    };
  }, [isRecording, isPaused]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await startRecording();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await stopRecording();
      setLastRecordingPath(path);
      onFinished?.(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [onFinished]);

  /** Throws away the in-progress recording — the toolbar stays put,
   * ready to record again, rather than swapping to the editor. */
  const discard = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await discardRecording();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Discards the current recording and immediately starts a fresh one
   * against the same source. */
  const restart = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await discardRecording();
      await startRecording();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const togglePause = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (isPaused) {
        await resumeRecording();
        setIsPaused(false);
      } else {
        await pauseRecording();
        setIsPaused(true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [isPaused]);

  return {
    isRecording,
    isPaused,
    busy,
    error,
    lastRecordingPath,
    elapsedMs,
    start,
    stop,
    discard,
    restart,
    togglePause,
  };
}
