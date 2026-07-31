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
 * one — including the `Request` instances ky hands it — and merges the
 * request's headers. It only reads `init.signal`, though; a signal carried on
 * a `Request` is forwarded explicitly below.
 *
 * Cross-origin rejections come from Rust, not the browser, so they are never
 * a `TypeError` and can't satisfy ky's `isRawNetworkError` check — natively
 * routed requests do not get ky's automatic network-error retries. This is
 * accepted deliberately: normalizing the rejection into a `TypeError` would
 * also make aborted requests indistinguishable from failed ones, since the
 * plugin rejects both with a plain `Error`, and ky would then retry
 * cancellations.
 */
export function createFetch(
  webviewFetch: FetchFn,
  nativeFetch: FetchFn = tauriFetch,
): FetchFn {
  return (input, init) => {
    const url = input instanceof Request ? input.url : input

    if (!needsNativeTransport(url)) return webviewFetch(input, init)

    // The native transport reads the abort signal from init.signal only —
    // it never looks at a signal carried on a Request. ky, however, puts the
    // signal on the Request and strips it out of init before calling fetch.
    // Forward the Request's own signal so cancellation (including ky's own
    // timeout()) actually aborts the in-flight native request.
    if (input instanceof Request && !init?.signal) {
      return nativeFetch(input, { ...init, signal: input.signal })
    }

    return nativeFetch(input, init)
  }
}
