use serde::Serialize;
use tauri::AppHandle;

use crate::projects;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    path: String,
    name: String,
}

/// Recent recordings for the editor's "Show previous projects" submenu —
/// the same `~/Movies/Dolly`, most-recently-modified-first list the tray
/// menu's own "Show previous projects" submenu uses.
#[tauri::command]
pub fn list_recent_projects(app: AppHandle, limit: usize) -> Vec<RecentProject> {
    projects::list_recent(&app, limit)
        .into_iter()
        .map(|path| {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Recording")
                .to_string();
            RecentProject {
                path: path.display().to_string(),
                name,
            }
        })
        .collect()
}
