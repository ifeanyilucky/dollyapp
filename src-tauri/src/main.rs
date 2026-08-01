// Prevents an additional console window on Windows in release builds. No-op
// on macOS, kept for when a Windows port is ever considered.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dolly_lib::run()
}
