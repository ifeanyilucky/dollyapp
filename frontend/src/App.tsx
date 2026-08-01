import { PermissionsGate } from "./permissions/PermissionsGate";

/**
 * The recorder UI (PRD §9) lands with task #15 — see ARCHITECTURE.md.
 * `PermissionsGate` blocks everything behind it until Screen Recording is
 * granted, per the pre-prompt-before-OS-prompt rule.
 */
function App() {
  return (
    <PermissionsGate>
      <main className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-400">
        <div className="text-center">
          <h1 className="text-lg font-medium text-neutral-200">Dolly</h1>
          <p className="mt-1 text-sm">Screen Recording granted. Recorder UI not built yet.</p>
        </div>
      </main>
    </PermissionsGate>
  );
}

export default App;
