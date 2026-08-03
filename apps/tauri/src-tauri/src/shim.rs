//! Delivers the JS transport shim to every webview.
//!
//! Registering the script on a plugin rather than on a window builder is
//! deliberate: a builder script only reaches windows constructed in Rust, which
//! would force programmatic window creation forever. A plugin script reaches
//! every webview — including the one Android creates — so the window stays
//! declared in tauri.conf.json.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// The transport shim, bundled by `apps/tauri/build-shim.mjs` on every
/// dev/build run (gitignored; the bundle embeds here via include_str!).
const SHIM: &str = include_str!("../shim.js");

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mcxd-shim").js_init_script(SHIM.to_string()).build()
}
