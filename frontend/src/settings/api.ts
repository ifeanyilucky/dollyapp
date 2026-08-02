import { invoke } from "@tauri-apps/api/core";

export interface SettingsInfo {
  showInDock: boolean;
  recordingsDir: string;
}

export function getSettings(): Promise<SettingsInfo> {
  return invoke("get_settings");
}

export function setShowInDock(enabled: boolean): Promise<void> {
  return invoke("set_show_in_dock", { enabled });
}

/** Opens (or focuses) the settings window — called from the toolbar's
 * Settings button; the tray menu's "Show settings" item triggers the same
 * Rust command directly, without going through `invoke()`. */
export function openSettingsWindow(): Promise<void> {
  return invoke("open_settings_window");
}

/** Reuses the same Rust command the editor's "Reveal in Finder" button
 * calls — it just runs `open <path>`, which works for the recordings
 * folder itself as well as a single bundle. */
export function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { bundlePath: path });
}
