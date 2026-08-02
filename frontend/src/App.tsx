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
      {openBundlePath && <EditorView bundlePath={openBundlePath} onClose={closeEditor} />}
    </PermissionsGate>
  );
}

export default App;
