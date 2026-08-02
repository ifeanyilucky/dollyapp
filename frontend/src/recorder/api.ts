import { invoke } from "@tauri-apps/api/core";

/** Payload of the `recording-state-changed` event — see
 * `src-tauri/src/recorder::RECORDING_STATE_EVENT`. */
export const RECORDING_STATE_EVENT = "recording-state-changed";

/** Payload (the finished bundle's path) of the `recording-finished` event
 * — see `src-tauri/src/recorder::RECORDING_FINISHED_EVENT`. The floating
 * toolbar (where recording starts/stops) and the regular window (which
 * opens the result in the editor) are separate webviews with no shared
 * React state, so this event is how the latter learns what to open. */
export const RECORDING_FINISHED_EVENT = "recording-finished";

/** Hides the regular window and shows the floating toolbar — called once,
 * right after Screen Recording permission is granted for the first time
 * (see `PermissionsGate`'s `onGranted`). */
export function enterToolbarMode(): Promise<void> {
  return invoke("enter_toolbar_mode");
}

/** Hides the regular window and shows the floating toolbar — the reverse
 * of the swap `recording-finished` triggers, called when the editor closes. */
export function returnToToolbar(): Promise<void> {
  return invoke("return_to_toolbar");
}

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

/** Hides the floating toolbar (Escape, or the toolbar's close button). The
 * app keeps running in the background — the tray menu's "Show Toolbar"
 * brings it back. */
export function closeToolbar(): Promise<void> {
  return invoke("close_toolbar");
}
