// Schemes the Tauri transports can carry. Anything else (blob:, data:,
// filesystem:) is meaningless to them and stays on the webview.
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
  let parsed: URL
  try {
    parsed = new URL(String(url), globalThis.location?.href)
  } catch {
    // Unparseable: hand it to the platform implementation and let it raise its
    // own, more familiar error.
    return false
  }

  if (!NATIVE_PROTOCOLS.has(parsed.protocol)) return false

  // ws:/wss: serialize their origin as "ws://host:port", which can never equal
  // an http: location.origin. Compare hosts so a dev-server socket is
  // recognized as same-origin.
  if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
    return parsed.host !== globalThis.location?.host
  }

  return parsed.origin !== globalThis.location?.origin
}
