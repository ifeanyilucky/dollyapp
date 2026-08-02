import { useState } from "react";
import {
  getMicrophoneStatus,
  openMicrophoneSettings,
  requestMicrophonePermission,
} from "../permissions/api";
import { setMicEnabled } from "./api";

/**
 * Mic capture is opt-in per recording, and permission is requested at the
 * moment it's switched on — never at launch (ARCHITECTURE.md,
 * "Permissions", rule 2). This is the one place that request fires from.
 */
export function MicToggle({ disabled }: { disabled: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [deniedHint, setDeniedHint] = useState(false);

  async function toggle() {
    if (enabled) {
      setEnabled(false);
      setDeniedHint(false);
      await setMicEnabled(false);
      return;
    }

    const status = await getMicrophoneStatus();
    const granted = status === "authorized" || (await requestMicrophonePermission());

    if (!granted) {
      setDeniedHint(true);
      return;
    }

    setDeniedHint(false);
    setEnabled(true);
    await setMicEnabled(true);
  }

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={() => void toggle()}
          className="accent-neutral-100"
        />
        Microphone
      </label>
      {deniedHint && (
        <button
          type="button"
          onClick={() => void openMicrophoneSettings()}
          className="text-xs text-amber-400 underline underline-offset-2"
        >
          Enable in System Settings
        </button>
      )}
    </div>
  );
}
