// ws/wss are scheme-upgraded variants of http/https for origin purposes:
// Vite's HMR WebSocket in dev (http://localhost:3000 page, ws://localhost:3000
// socket) must stay on the native webview implementation.
const SCHEME_ALIASES: Record<string, string> = { ws: 'http', wss: 'https' }

function normalizedScheme(protocol: string): string {
  const scheme = protocol.replace(/:$/, '')
  return SCHEME_ALIASES[scheme] ?? scheme
}

// Only these schemes may route through the Tauri plugins. Everything else —
// blob:/data:, Tauri's own ipc:// IPC transport, file:, about:, malformed
// URLs — takes the captured native implementation. ipc:// in particular must
// never reach the HTTP plugin: plugin fetch performs its IPC via invoke(),
// which on Linux WebKitGTK is itself a fetch to the ipc:// scheme, so routing
// it through the plugin would recurse forever (wrapper → plugin fetch →
// invoke → ipc fetch → wrapper).
const PLUGIN_SCHEMES = new Set(['http', 'https', 'ws', 'wss'])

/**
 * Decide whether a URL must go through the captured native transport or the
 * Tauri plugin transport. Same-origin and relative URLs use the native
 * implementation; cross-origin http(s)/ws(s) use the plugins; anything else
 * (blob:, data:, ipc:, file:, malformed) uses the native implementation
 * (native fetch owns the TypeError for the latter).
 */
export function shouldUseNativeTransport(url: string, origin: string): boolean {
  try {
    const base = new URL(origin)
    const target = new URL(url, origin)
    if (!PLUGIN_SCHEMES.has(target.protocol.replace(/:$/, ''))) return true
    return (
      normalizedScheme(target.protocol) === normalizedScheme(base.protocol) &&
      target.host === base.host
    )
  } catch {
    return true
  }
}
