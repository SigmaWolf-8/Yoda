// Prevents an extra console window from opening alongside the app on Windows
// release builds. Debug builds keep the console so sidecar logs stay visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    yoda_desktop_lib::run()
}
