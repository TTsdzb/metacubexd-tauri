import { createBridge } from './bridge'
import { installDragRegions } from './drag'
import { createFetch } from './fetch'
import { installResizeHandles } from './resize'
import { createWebSocket } from './websocket'

export interface ShimTarget {
  fetch: typeof globalThis.fetch
  WebSocket: typeof globalThis.WebSocket
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

  // Both transports keep the captured original for same-origin traffic, so
  // the webview's own implementations must be read before they are replaced.
  target.fetch = createFetch(target.fetch.bind(target))
  target.WebSocket = createWebSocket(target.WebSocket)

  // Electron reports linux/darwin/win32; shim.rs maps Rust's OS names onto
  // those and passes android/ios through. isDesktop comes from Rust's
  // cfg!(desktop). Defaults cover a missing prelude: linux and desktop are the
  // common case, and only the darwin branch changes UI behavior.
  target.metacubexd = createBridge(
    target.__MCXD_PLATFORM__ ?? 'linux',
    target.__MCXD_IS_DESKTOP__ ?? true,
  )

  // The DOM-touching window-management wiring. Isolated because, unlike the
  // transports above, it is not load-bearing: a throw here degrades to a
  // title bar you cannot drag or an edge you cannot resize, rather than
  // leaving the rest of install() unrun. Resize goes on first so its
  // capture-phase listener is registered before drag's — the top border
  // overlaps the title bar strip, and at the very edge resizing must win.
  try {
    installResizeHandles(target.document)
  } catch (error) {
    console.error('metacubexd shim: installResizeHandles failed', error)
  }

  try {
    installDragRegions(target.document)
  } catch (error) {
    console.error('metacubexd shim: installDragRegions failed', error)
  }
}
