/**
 * Placeholder shell. The recorder/editor UI (PRD §9) lands in M1/M2 — see
 * ARCHITECTURE.md. Nothing here reads real data yet; it exists so `pnpm
 * tauri dev` has something to render while the Rust side is built out.
 */
function App() {
  return (
    <main className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-400">
      <div className="text-center">
        <h1 className="text-lg font-medium text-neutral-200">Dolly</h1>
        <p className="mt-1 text-sm">Pre-alpha — recorder UI not built yet.</p>
      </div>
    </main>
  );
}

export default App;
