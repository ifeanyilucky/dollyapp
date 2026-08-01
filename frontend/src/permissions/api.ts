import { invoke } from "@tauri-apps/api/core";

/** Mirrors `src-tauri/src/permissions::PermissionStatus`. */
export type PermissionStatus = "notDetermined" | "denied" | "restricted" | "authorized";

export function getScreenRecordingStatus(): Promise<PermissionStatus> {
  return invoke("screen_recording_permission_status");
}

export function getMicrophoneStatus(): Promise<PermissionStatus> {
  return invoke("microphone_permission_status");
}

export function getCameraStatus(): Promise<PermissionStatus> {
  return invoke("camera_permission_status");
}

/** Only call after showing the pre-prompt explanation screen (ARCHITECTURE.md,
 * "Permissions", rule 1) — this is what triggers the OS dialog. */
export function requestScreenRecordingPermission(): Promise<boolean> {
  return invoke("request_screen_recording_permission");
}

/** Only call at the moment the user switches mic recording on — never on
 * app launch (ARCHITECTURE.md, "Permissions", rule 2). */
export function requestMicrophonePermission(): Promise<boolean> {
  return invoke("request_microphone_permission");
}

/** Same lazy-request rule as mic, for the webcam overlay. */
export function requestCameraPermission(): Promise<boolean> {
  return invoke("request_camera_permission");
}

export function openScreenRecordingSettings(): Promise<void> {
  return invoke("open_screen_recording_settings");
}

export function openMicrophoneSettings(): Promise<void> {
  return invoke("open_microphone_settings");
}

export function openCameraSettings(): Promise<void> {
  return invoke("open_camera_settings");
}
