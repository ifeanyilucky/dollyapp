import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { EditorView } from "./editor/EditorView";
import { PermissionsGate } from "./permissions/PermissionsGate";
import { enterToolbarMode, RECORDING_FINISHED_EVENT, returnToToolbar } from "./recorder/api";

/**
 * Root of the *regular* window — reserved for the first-run permission
 * flow and the post-recording editor. Recording itself starts/stops from
 * the floating toolbar (`ToolbarView`, a separate window — see
 * `main.tsx`); this window stays hidden the rest of the time (Rust-side
 * window swapping lives in `recorder::stop` and the `enter_toolbar_mode`/
 * `return_to_toolbar` commands).
 */
function App() {
  const [openBundlePath, setOpenBundlePath] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<string>(RECORDING_FINISHED_EVENT, (event) => {
      setOpenBundlePath(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  function closeEditor() {
    setOpenBundlePath(null);
    void returnToToolbar();
  }

  return (
    <PermissionsGate onGranted={() => void enterToolbarMode()}>
      {openBundlePath && (
        <EditorView
          // Remounts the whole editor on switch (folder dropdown's "Show
          // previous projects") instead of hot-swapping `bundlePath` in
          // place — the editor holds a lot of per-recording state (slices,
          // trim, zoom keyframes, style, ...) that only resets correctly
          // by tearing down and remounting, not by an effect keyed on the
          // path alone.
          key={openBundlePath}
          bundlePath={openBundlePath}
          onClose={closeEditor}
          onOpenProject={setOpenBundlePath}
        />
      )}
    </PermissionsGate>
  );
}

export default App;
