import { createBridge } from './bridge'
import { installDragRegions } from './drag'
import { createFetch } from './fetch'
import { createWebSocketClass } from './websocket'

interface ShimTarget {
  fetch: typeof globalThis.fetch
  WebSocket: unknown
  document: Document
  metacubexd?: unknown
  /** Both injected by src-tauri/src/shim.rs ahead of this bundle. */
  __MCXD_PLATFORM__?: string
  __MCXD_IS_DESKTOP__?: boolean
  __MCXD_SHIM_INSTALLED__?: boolean
}

/**
 * Patch a global object so the dashboard talks to the network through Tauri.
 *
 * Runs as a webview initialization script, i.e. at document-start on every
 * page load, before any application code. Nothing here touches
 * window.__TAURI_INTERNALS__ — the plugin calls it lazily, per request — so
 * install order relative to Tauri's own bootstrap does not matter.
 */
export function install(target: ShimTarget): void {
  if (target.__MCXD_SHIM_INSTALLED__) return
  target.__MCXD_SHIM_INSTALLED__ = true

  target.fetch = createFetch(target.fetch.bind(target))
  target.WebSocket = createWebSocketClass()

  // Electron reports linux/darwin/win32; shim.rs maps Rust's OS names onto
  // those and passes android/ios through. isDesktop comes from Rust's
  // cfg!(desktop). Defaults cover a missing prelude: linux and desktop are the
  // common case, and only the darwin branch changes UI behavior.
  target.metacubexd = createBridge(
    target.__MCXD_PLATFORM__ ?? 'linux',
    target.__MCXD_IS_DESKTOP__ ?? true,
  )

  installDragRegions(target.document)
}
