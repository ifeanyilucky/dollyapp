pub mod bundle;
pub mod capture;
pub mod clock;
pub mod commands;
pub mod cursor;
pub mod encode;
pub mod export;
pub mod fs;
pub mod permissions;
pub mod recorder;

pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::screen_recording_permission_status,
            commands::microphone_permission_status,
            commands::camera_permission_status,
            commands::request_screen_recording_permission,
            commands::request_microphone_permission,
            commands::request_camera_permission,
            commands::open_screen_recording_settings,
            commands::open_microphone_settings,
            commands::open_camera_settings,
        ])
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
