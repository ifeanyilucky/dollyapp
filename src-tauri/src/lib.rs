pub mod bundle;
pub mod capture;
pub mod clock;
pub mod cursor;
pub mod encode;
pub mod export;
pub mod fs;

pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Recorder/editor commands land in M1/M2; the window starts
            // hidden (see tauri.conf.json) until there's a UI worth
            // showing.
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Dolly application");
}
