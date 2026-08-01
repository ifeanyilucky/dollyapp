import { useEffect, useState, type ReactNode } from "react";
import {
  getScreenRecordingStatus,
  openScreenRecordingSettings,
  requestScreenRecordingPermission,
  type PermissionStatus,
} from "./api";

type GateState =
  | { phase: "checking" }
  | { phase: "needsPrompt" }
  | { phase: "requesting" }
  /** Screen Recording status can't distinguish "denied" from "never asked"
   * (see the doc comment on `screen_recording_status` in
   * src-tauri/src/permissions/macos.rs) — after a request that didn't
   * result in `authorized`, this is the only state we can show. */
  | { phase: "stillNotGranted" }
  | { phase: "granted" };

/**
 * Blocks the recorder UI behind Screen Recording permission, showing our
 * own explanation before the OS prompt ever fires — ARCHITECTURE.md,
 * "Permissions", rule 1: never trigger a permission prompt cold.
 */
export function PermissionsGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ phase: "checking" });

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function refreshStatus() {
    const status = await getScreenRecordingStatus();
    setState(toGateState(status));
  }

  async function handleContinue() {
    setState({ phase: "requesting" });
    await requestScreenRecordingPermission();
    const status = await getScreenRecordingStatus();
    // Historically requires an app relaunch to take effect even once
    // granted (ARCHITECTURE.md, "Permissions", rule 4) — re-checking here
    // catches the case where it didn't.
    setState(status === "authorized" ? { phase: "granted" } : { phase: "stillNotGranted" });
  }

  if (state.phase === "checking") {
    return null;
  }

  if (state.phase === "granted") {
    return <>{children}</>;
  }

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-neutral-950 px-8 text-neutral-300">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-medium text-neutral-100">Screen Recording access</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          Dolly needs Screen Recording permission to capture your display. Nothing you record
          leaves this machine unless you export and share it yourself.
        </p>

        {state.phase === "stillNotGranted" && (
          <p className="mt-3 text-sm leading-relaxed text-amber-400">
            Still not granted. Open System Settings, enable Dolly under Screen Recording, then
            relaunch the app — macOS often requires a relaunch for this permission to take
            effect.
          </p>
        )}

        <div className="mt-6 flex flex-col items-center gap-2">
          {state.phase !== "stillNotGranted" ? (
            <button
              type="button"
              onClick={handleContinue}
              disabled={state.phase === "requesting"}
              className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
            >
              {state.phase === "requesting" ? "Requesting…" : "Continue"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void openScreenRecordingSettings()}
                className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900"
              >
                Open System Settings
              </button>
              <button
                type="button"
                onClick={() => void refreshStatus()}
                className="text-xs text-neutral-500 underline underline-offset-2"
              >
                I've granted it — check again
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function toGateState(status: PermissionStatus): GateState {
  return status === "authorized" ? { phase: "granted" } : { phase: "needsPrompt" };
}
