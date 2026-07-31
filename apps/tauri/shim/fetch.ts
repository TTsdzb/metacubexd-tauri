import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { needsNativeTransport } from './origin'

export type FetchFn = typeof globalThis.fetch

/**
 * Build the replacement for `globalThis.fetch`.
 *
 * Cross-origin requests are performed by Rust's reqwest, so there is no CORS
 * preflight and no mixed-content block when the dashboard talks to a plain-http
 * core on the LAN. Everything same-origin keeps the webview implementation.
 *
 * `@tauri-apps/plugin-http`'s fetch accepts the same inputs as the platform
 * one — including the `Request` instances ky hands it — merges the request's
 * headers, and honors `init.signal`, so call sites need no adjustment.
 */
export function createFetch(
  webviewFetch: FetchFn,
  nativeFetch: FetchFn = tauriFetch as FetchFn,
): FetchFn {
  return (input, init) => {
    const url = input instanceof Request ? input.url : (input as string | URL)

    return needsNativeTransport(url)
      ? nativeFetch(input, init)
      : webviewFetch(input, init)
  }
}
