// ws/wss are scheme-upgraded variants of http/https for origin purposes:
// Vite's HMR WebSocket in dev (http://localhost:3000 page, ws://localhost:3000
// socket) must stay on the native webview implementation.
const SCHEME_ALIASES: Record<string, string> = { ws: 'http', wss: 'https' }

function normalizedScheme(protocol: string): string {
  const scheme = protocol.replace(/:$/, '')
  return SCHEME_ALIASES[scheme] ?? scheme
}

/**
 * Decide whether a URL must go through the captured native transport or the
 * Tauri plugin transport. Same-origin and relative URLs use the native
 * implementation; anything else uses the plugins. blob:/data: and malformed
 * URLs always take the native path (native fetch owns the TypeError for the
 * latter).
 */
export function shouldUseNativeTransport(url: string, origin: string): boolean {
  try {
    const base = new URL(origin)
    const target = new URL(url, origin)
    if (target.protocol === 'blob:' || target.protocol === 'data:') return true
    return (
      normalizedScheme(target.protocol) === normalizedScheme(base.protocol) &&
      target.host === base.host
    )
  } catch {
    return true
  }
}
