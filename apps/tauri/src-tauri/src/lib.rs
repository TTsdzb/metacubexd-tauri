mod shim;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(shim::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_websocket::init());

    // Window geometry restore is desktop-only; on Android there is no window to
    // restore. Gated rather than removed so the Android target stays reachable.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
