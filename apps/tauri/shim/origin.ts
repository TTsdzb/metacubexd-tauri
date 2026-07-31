// Schemes the Tauri transports can carry. Anything else (blob:, data:,
// filesystem:) is meaningless to them and stays on the webview. This is also
// what keeps the shipped app's own assets local on macOS: the page there is
// served from tauri://localhost, so a relative URL resolves to a tauri:
// URL, which is not in this set and never reaches the same-origin check
// below at all.
const NATIVE_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])

/**
 * Should this URL travel through the Tauri native transport?
 *
 * Same-origin and relative URLs keep the webview's own implementation: that
 * covers Nuxt's internal requests, config.js, locally served fonts and — in
 * dev — Vite's HMR socket. Everything else (the user's Mihomo backend, the
 * GitHub release check) goes native, where CORS and mixed-content rules do not
 * apply.
 */
export function needsNativeTransport(url: string | URL): boolean {
  const page = globalThis.location
  let parsed: URL
  try {
    parsed = new URL(String(url), page?.href)
  } catch {
    // Unparseable: hand it to the platform implementation and let it raise its
    // own, more familiar error.
    return false
  }

  if (!NATIVE_PROTOCOLS.has(parsed.protocol)) return false

  if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
    // ws:/wss: serialize their origin as "ws://host:port", which can never
    // equal an http: location.origin, so compare hosts instead. That host
    // shortcut is a dev-only concession for Vite's HMR socket
    // (http://localhost:3000 page, ws://localhost:3000 socket) — it only
    // means anything when the page itself is http(s), the one case where a
    // same-origin socket can exist. In production the page origin is
    // tauri://localhost or http://tauri.localhost, so a bare host match
    // (e.g. "localhost") must not short-circuit the shipped app into
    // treating a same-machine ws: backend as same-origin.
    const pageIsHttp = page?.protocol === 'http:' || page?.protocol === 'https:'
    return !pageIsHttp || parsed.host !== page.host
  }

  return parsed.origin !== page?.origin
}
