import { useState } from "react";
import { EditorView } from "./editor/EditorView";
import { PermissionsGate } from "./permissions/PermissionsGate";
import { RecorderView } from "./recorder/RecorderView";

/**
 * `PermissionsGate` blocks everything behind it until Screen Recording is
 * granted, per the pre-prompt-before-OS-prompt rule (ARCHITECTURE.md).
 * Below that, this is the whole app's navigation: recorder until a
 * recording finishes, then the editor/preview for that recording.
 */
function App() {
  const [openBundlePath, setOpenBundlePath] = useState<string | null>(null);

  return (
    <PermissionsGate>
      {openBundlePath ? (
        <EditorView bundlePath={openBundlePath} onClose={() => setOpenBundlePath(null)} />
      ) : (
        <RecorderView onFinished={setOpenBundlePath} />
      )}
    </PermissionsGate>
  );
}

export default App;
