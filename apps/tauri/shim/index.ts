import { createFetch } from './fetch'
import { createWebSocket } from './websocket'

export interface ShimTarget {
  fetch: typeof globalThis.fetch
  WebSocket: typeof globalThis.WebSocket
}

const INSTALLED = Symbol('metacubexd-shim-installed')

/**
 * Patch a global object so the dashboard talks to the network through Tauri.
 * Runs as a webview initialization script, i.e. at document-start on every
 * page load, before any application code. Nothing here touches
 * window.__TAURI_INTERNALS__ — the plugin packages call it lazily, per
 * request — so install order relative to Tauri's own bootstrap does not
 * matter. Same-origin traffic keeps the captured native implementations.
 */
export function install(target: ShimTarget, origin?: string): void {
  if ((target as unknown as Record<symbol, unknown>)[INSTALLED]) return
  ;(target as unknown as Record<symbol, unknown>)[INSTALLED] = true

  const base = origin ?? globalThis.location.origin
  target.fetch = createFetch(target.fetch.bind(target), base)
  target.WebSocket = createWebSocket(target.WebSocket, base)
}
