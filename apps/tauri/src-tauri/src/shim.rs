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

/// The transport shim, bundled by `apps/tauri/build-shim.mjs`. Every dev and
/// build script regenerates it before cargo runs.
const SHIM: &str = include_str!("../shim.js");

/// Electron-style platform name. `packages/ui`'s `useDesktop()` compares
/// against these strings, and `darwin` gates its macOS branches. Rust's
/// android/ios names pass through unchanged.
fn platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    // js_init_script wraps its payload in an IIFE, so the prelude assigns to
    // `window` explicitly. {:?} on a &str emits a correctly escaped JS string
    // literal.
    //
    // `cfg!(desktop)` is the alias tauri-build defines. Handing it to the
    // webview is what stops the dashboard drawing a desktop title bar and
    // window controls on Android, without the JS side guessing from a platform
    // string.
    //
    // The leading "use strict" is this script's own: esbuild emits one at the
    // top of the bundle, but prepending the prelude pushes it out of directive
    // prologue position, where it is an ordinary string expression and does
    // nothing. The prelude must still come first — install() reads both
    // globals when the bundle executes — so the directive is re-stated here
    // rather than the two being reordered.
    let script = format!(
        "\"use strict\";\nwindow.__MCXD_PLATFORM__ = {:?};\nwindow.__MCXD_IS_DESKTOP__ = {};\n{}",
        platform(),
        cfg!(desktop),
        SHIM
    );

    Builder::new("mcxd-shim").js_init_script(script).build()
}
