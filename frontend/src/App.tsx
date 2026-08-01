import { PermissionsGate } from "./permissions/PermissionsGate";
import { RecorderView } from "./recorder/RecorderView";

/**
 * `PermissionsGate` blocks everything behind it until Screen Recording is
 * granted, per the pre-prompt-before-OS-prompt rule (ARCHITECTURE.md).
 */
function App() {
  return (
    <PermissionsGate>
      <RecorderView />
    </PermissionsGate>
  );
}

export default App;
