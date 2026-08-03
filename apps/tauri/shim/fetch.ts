import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { shouldUseNativeTransport } from './origin'

/**
 * fetch replacement: same-origin/relative traffic goes to the captured native
 * fetch; everything else is performed by Rust (reqwest) through the official
 * HTTP plugin — no CORS preflight, no mixed-content block, system proxy not
 * consulted (a LAN core must not loop back through the proxy it serves).
 *
 * `ky` (the dashboard's HTTP client) resolves `options.fetch ?? globalThis.fetch`
 * per request, so a patch installed before app boot is picked up by every
 * client created later.
 */
export function createFetch(
  nativeFetch: typeof globalThis.fetch,
  origin: string,
): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    if (shouldUseNativeTransport(url, origin)) {
      return nativeFetch(input, init)
    }
    // The plugin accepts RequestInit & ClientOptions; both share the Web
    // fetch shape, so the call is compatible despite the narrower typing.
    return pluginFetch(input as string, init as RequestInit)
  }) as typeof globalThis.fetch
}
