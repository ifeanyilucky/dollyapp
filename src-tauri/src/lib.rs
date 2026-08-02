pub mod audio;
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
mod shortcut;
mod toolbar;
mod tray;

pub fn run() {
    // stderr, not stdout: stdout is block-buffered when the app's output
    // is piped (as under `tauri dev`), which would swallow runtime logs.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
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
            commands::list_capture_targets,
            commands::select_capture_target,
            commands::select_capture_area,
            commands::open_area_selector,
            commands::confirm_area_selection,
            commands::cancel_area_selection,
            commands::open_window_picker,
            commands::window_info_at_point,
            commands::window_info_at_cursor,
            commands::pick_window_and_record,
            commands::cancel_window_picker,
            commands::recording_status,
            commands::start_recording,
            commands::stop_recording,
            commands::discard_recording,
            commands::pause_recording,
            commands::resume_recording,
            commands::set_mic_enabled,
            commands::load_recording,
            commands::reveal_in_finder,
            commands::delete_recording,
            commands::enter_toolbar_mode,
            commands::return_to_toolbar,
            commands::close_toolbar,
            commands::set_toolbar_hit_rect,
        ])
        .manage(recorder::RecorderState::default())
        .manage(toolbar::ToolbarHitRect::default())
        .setup(|app| {
            use tauri::Manager;

            tray::setup(app.handle())?;
            shortcut::setup(app.handle())?;

            // Once Screen Recording is granted, the floating toolbar (not
            // the regular window) is the app's primary UI — see
            // `toolbar`'s doc comment. On a fresh install it isn't granted
            // yet, so fall back to the regular window for the first-run
            // permission flow; the frontend calls `enter_toolbar_mode`
            // once that flow finishes (see `PermissionsGate`'s `onGranted`).
            if permissions::screen_recording_status() == permissions::PermissionStatus::Authorized {
                toolbar::show(app.handle())?;
            } else if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Dolly application");
}
