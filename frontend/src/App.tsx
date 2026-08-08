import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open } from "@tauri-apps/plugin-dialog";
import { FileVideo } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EditorView } from "./editor/EditorView";
import { importVideo } from "./editor/api";
import { PermissionsGate } from "./permissions/PermissionsGate";
import { enterToolbarMode, RECORDING_FINISHED_EVENT, returnToToolbar } from "./recorder/api";

/** Extensions we're willing to accept from drag-and-drop / the import
 * picker. The actual decode is done by AVFoundation in the Rust layer, so
 * anything it can open works; this list just decides whether a dropped file
 * is worth trying. */
const IMPORTABLE_EXTENSIONS = new Set(["mp4", "mov", "m4v", "avi", "mkv", "webm", "mpg", "mpeg"]);

function isImportable(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext !== undefined && IMPORTABLE_EXTENSIONS.has(ext);
}

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
  const [dragActive, setDragActive] = useState(false);
  const importInFlight = useRef(false);

  useEffect(() => {
    const unlisten = listen<string>(RECORDING_FINISHED_EVENT, (event) => {
      setOpenBundlePath(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  /** Picks a file via the OS dialog (or uses an already-chosen `path` from
   * drag-and-drop) and imports it, opening the new bundle in the editor. */
  async function handleImport(path?: string) {
    if (importInFlight.current) return;
    importInFlight.current = true;
    try {
      const videoPath =
        path ??
        (await open({
          title: "Import video",
          multiple: false,
          directory: false,
          filters: [{ name: "Video", extensions: [...IMPORTABLE_EXTENSIONS] }],
        }));
      if (videoPath == null) return; // dialog cancelled
      const bundlePath = await importVideo(videoPath);
      setOpenBundlePath(bundlePath);
    } catch (err) {
      await message(`Couldn't import that video:\n${String(err)}`, {
        kind: "error",
        title: "Import failed",
      });
    } finally {
      importInFlight.current = false;
    }
  }

  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setDragActive(true);
      } else if (event.payload.type === "leave") {
        setDragActive(false);
      } else if (event.payload.type === "drop") {
        setDragActive(false);
        const video = event.payload.paths.find(isImportable);
        if (video != null) void handleImport(video);
      }
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
          // previous projects" and "Import video…") instead of hot-swapping
          // `bundlePath` in place — the editor holds a lot of per-recording
          // state (slices, trim, zoom keyframes, style, ...) that only
          // resets correctly by tearing down and remounting, not by an
          // effect keyed on the path alone.
          key={openBundlePath}
          bundlePath={openBundlePath}
          onClose={closeEditor}
          onOpenProject={setOpenBundlePath}
          onImportVideo={() => void handleImport()}
        />
      )}
      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-600 bg-neutral-900/80 px-12 py-10 text-center shadow-2xl">
            <FileVideo className="h-10 w-10 text-neutral-300" />
            <div className="text-sm font-medium text-neutral-100">Drop to import a video</div>
            <div className="max-w-52 text-[12px] text-neutral-500">
              A new recording bundle will be created and opened in the editor
            </div>
          </div>
        </div>
      )}
    </PermissionsGate>
  );
}

export default App;
