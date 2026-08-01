import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import {
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
export function useRecordingState() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRecordingPath, setLastRecordingPath] = useState<string | null>(null);

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

  return { isRecording, isPaused, busy, error, lastRecordingPath, start, stop, togglePause };
}
