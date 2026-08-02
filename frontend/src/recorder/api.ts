import { invoke } from "@tauri-apps/api/core";

/** Payload of the `recording-state-changed` event — see
 * `src-tauri/src/recorder::RECORDING_STATE_EVENT`. */
export const RECORDING_STATE_EVENT = "recording-state-changed";

export function getRecordingStatus(): Promise<boolean> {
  return invoke("recording_status");
}

export function startRecording(): Promise<void> {
  return invoke("start_recording");
}

/** Resolves to the finished bundle's path once the video/cursor track are
 * written to disk. */
export function stopRecording(): Promise<string> {
  return invoke("stop_recording");
}

export function pauseRecording(): Promise<void> {
  return invoke("pause_recording");
}

export function resumeRecording(): Promise<void> {
  return invoke("resume_recording");
}

/** Only marks the toggle — the caller must already have confirmed
 * microphone permission (see `permissions/api.ts`,
 * `requestMicrophonePermission`) before enabling. */
export function setMicEnabled(enabled: boolean): Promise<void> {
  return invoke("set_mic_enabled", { enabled });
}
