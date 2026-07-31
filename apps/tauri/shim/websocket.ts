import PluginWebSocket from '@tauri-apps/plugin-websocket'
import { needsNativeTransport } from './origin'

/** The frame shape `tauri-plugin-websocket` pushes up its channel on success. */
export type Message =
  | { type: 'Text'; data: string }
  | { type: 'Binary'; data: number[] }
  | { type: 'Ping'; data: number[] }
  | { type: 'Pong'; data: number[] }
  | { type: 'Close'; data: { code: number; reason: string } | null }

/**
 * What the plugin's `addListener` callback actually delivers. The plugin's
 * own TypeScript declarations only describe `Message` — the success path —
 * but its Rust read loop pushes onto the same channel in two more cases:
 *
 *   - a bare JSON string, because a read error is serialized via `Error`'s
 *     `Serialize` impl (`serializer.serialize_str(self.to_string())`), not
 *     as a tagged `Message`. This is the *common* kernel-restart path:
 *     Mihomo's process exit drops the TCP connection with no close
 *     handshake, so tokio-tungstenite yields `Err(...)`, never
 *     `Ok(Message::Close(..))`;
 *   - `null`, for `Ok(Message::Frame(_))`, a raw-frame variant this plugin
 *     doesn't otherwise surface.
 *
 * Both must be treated as abnormal termination rather than ignored. Typing
 * the listener callback as `Message` (as the plugin's own declarations do)
 * hides this: a bare string's `.type` is `undefined`, no `switch` case
 * matches, and the socket would sit in OPEN forever with no error and no
 * `onclose` — so `useWebSocket.ts` never calls `scheduleReconnect()`, and
 * the dashboard goes silently, permanently stale.
 */
export type Incoming = Message | string | null

/** The slice of the plugin's socket this adapter drives. */
export interface PluginSocket {
  addListener: (cb: (msg: Incoming) => void) => () => void
  send: (message: string) => Promise<void>
  disconnect: () => Promise<void>
}

export type Connector = (url: string) => Promise<PluginSocket>

const CONNECTING = 0
const OPEN = 1
const CLOSING = 2
const CLOSED = 3

/**
 * Build a `WebSocket`-compatible class backed by `tauri-plugin-websocket`.
 *
 * Scope is deliberate: `packages/ui/composables/useWebSocket.ts` is the only
 * consumer, and it uses `onmessage`/`onerror`/`onclose`/`close()` and nothing
 * else. `addEventListener`, subprotocols, `bufferedAmount`, `extensions` and
 * Blob delivery are not implemented. If upstream ever starts using one, its
 * absence surfaces as an immediate TypeError rather than silent wrong
 * behavior.
 *
 * The connector is injected so the adapter is testable without a webview.
 */
export function createWebSocketClass(
  connect: Connector = (url) =>
    PluginWebSocket.connect(url) as unknown as Promise<PluginSocket>,
) {
  return class TauriWebSocket {
    static readonly CONNECTING = CONNECTING
    static readonly OPEN = OPEN
    static readonly CLOSING = CLOSING
    static readonly CLOSED = CLOSED

    readonly CONNECTING = CONNECTING
    readonly OPEN = OPEN
    readonly CLOSING = CLOSING
    readonly CLOSED = CLOSED

    readonly url: string
    readyState: number = CONNECTING

    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null

    #socket: PluginSocket | null = null
    #pending: string[] = []
    #closing = false
    #unlisten: (() => void) | null = null

    // Subprotocols are dropped: the plugin's `connect(url, config)` has no
    // subprotocol parameter, so there is nothing to forward them to. Mihomo's
    // Clash API does not negotiate any, and the one consumer that does —
    // Vite's HMR client, which asks for "vite-hmr" — never reaches this class
    // because `createWebSocket` below keeps same-origin sockets on the
    // webview's own implementation.
    constructor(url: string | URL, _protocols?: string | string[]) {
      this.url = String(url)
      // #open() only throws if a consumer handler (onopen/onerror/onclose)
      // throws synchronously; log rather than let it vanish as an unhandled
      // rejection, the same way a throwing platform handler would surface
      // in the console instead of nowhere.
      void this.#open().catch((error: unknown) => {
        console.error(
          'TauriWebSocket: unhandled error while opening',
          this.url,
          error,
        )
      })
    }

    async #open(): Promise<void> {
      let socket: PluginSocket
      try {
        socket = await connect(this.url)
      } catch (error) {
        this.#abnormalClose(String(error))
        return
      }

      // close() was called while the connect promise was in flight: honor it
      // rather than handing back a live socket nobody will ever close.
      if (this.#closing || this.readyState === CLOSED) {
        void socket.disconnect().catch(() => {})
        this.#finish(1000, '')
        return
      }

      this.#socket = socket
      this.readyState = OPEN
      this.#unlisten = socket.addListener((message) => this.#receive(message))

      for (const message of this.#pending.splice(0)) {
        void socket.send(message).catch(() => {})
      }

      this.onopen?.(new Event('open'))
    }

    #receive(message: Incoming): void {
      if (this.readyState !== OPEN) return

      // Untagged payload: the plugin's error channel, not a frame (see
      // `Incoming`). Code 1006 is what the platform reports for an abnormal
      // close with no close frame, which is exactly what this is.
      //
      // Also note: the plugin only removes its writer entry from the
      // Rust-side `ConnectionManager` on a clean `Ok(Message::Close(_))`. An
      // abnormal close like this one leaks that entry on the Rust side — an
      // upstream limitation this adapter cannot fix from JS. Recorded here
      // so nobody goes hunting for a JS-side cause.
      if (typeof message !== 'object' || message === null) {
        this.#abnormalClose(message === null ? '' : String(message))
        return
      }

      switch (message.type) {
        case 'Text':
          this.onmessage?.(new MessageEvent('message', { data: message.data }))
          break
        case 'Binary':
          // Mihomo speaks text frames; if a binary one ever arrives, decode it
          // rather than hand the UI a Blob it would fail to JSON.parse.
          this.onmessage?.(
            new MessageEvent('message', {
              data: new TextDecoder().decode(new Uint8Array(message.data)),
            }),
          )
          break
        case 'Close':
          this.#finish(message.data?.code ?? 1005, message.data?.reason ?? '')
          break
        case 'Ping':
        case 'Pong':
          break
        default: {
          // Defensive: an unrecognized future frame type must not silently
          // freeze the socket the same way an unhandled envelope shape would.
          const unexpected = message as { type: unknown }
          this.#abnormalClose(
            `unrecognized frame type: ${String(unexpected.type)}`,
          )
          break
        }
      }
    }

    /** onerror then a 1006 (abnormal) close — the plugin's error channel. */
    #abnormalClose(reason: string): void {
      this.onerror?.(new Event('error'))
      this.#finish(1006, reason)
    }

    #finish(code: number, reason: string): void {
      if (this.readyState === CLOSED) return
      this.readyState = CLOSED
      this.#socket = null
      this.#pending = []
      // Detach from the plugin's socket so a discarded adapter doesn't keep
      // its handler graph (which closes over the Pinia stores) alive.
      this.#unlisten?.()
      this.#unlisten = null
      this.onclose?.(
        new CloseEvent('close', { code, reason, wasClean: code === 1000 }),
      )
    }

    send(data: string): void {
      if (this.readyState === CLOSING || this.readyState === CLOSED) return

      const message = String(data)
      const socket = this.#socket
      if (!socket) {
        // Still CONNECTING. Implementing send() at all is worth doing
        // properly — a WebSocket without it is a strange object — and the
        // platform WebSocket throws here; buffering instead lets a send
        // issued during the ordinary CONNECTING race succeed once the
        // socket opens.
        this.#pending.push(message)
        return
      }

      void socket.send(message).catch(() => {})
    }

    close(code = 1000, reason = ''): void {
      if (this.readyState === CLOSING || this.readyState === CLOSED) return

      this.#closing = true
      const socket = this.#socket
      if (!socket) {
        // Connect is still in flight; #open() sees #closing and cleans up.
        this.readyState = CLOSING
        return
      }

      this.readyState = CLOSING
      void socket
        .disconnect()
        // disconnect() rejects (e.g. `ConnectionNotFound`) when the
        // Rust-side connection is already gone — expected for a socket
        // that already died abnormally. Swallow it so #finish still runs.
        .catch(() => {})
        .finally(() => this.#finish(code, reason))
        .catch((error: unknown) => {
          // #finish() calls the consumer's onclose synchronously; if that
          // throws, .finally()'s returned promise rejects. Log with enough
          // context to find the socket rather than let it vanish as an
          // unhandled rejection.
          console.error(
            'TauriWebSocket: unhandled error while closing',
            this.url,
            error,
          )
        })
    }
  }
}

/** Anything `new`-able the way `WebSocket` is. */
export type WebSocketCtor = new (
  url: string | URL,
  protocols?: string | string[],
) => object

/**
 * Build the replacement for `globalThis.WebSocket`.
 *
 * The mirror image of `createFetch`: cross-origin sockets go through
 * `tauri-plugin-websocket`, everything same-origin keeps the webview's own
 * implementation. Routing *every* socket natively would break `pnpm dev:tauri`
 * — the page is served from the Vite dev server, whose HMR client constructs
 * `new WebSocket(url, 'vite-hmr')` and then calls `addEventListener`, which
 * `TauriWebSocket` deliberately does not implement. Hot reload would silently
 * never connect.
 *
 * A `Proxy` rather than a wrapper function because `WebSocket` is used as a
 * constructor and read for its `CONNECTING`/`OPEN`/`CLOSING`/`CLOSED` statics;
 * the proxy forwards every non-construct operation to the real global for
 * free, so only the routing decision is ours.
 *
 * One fidelity gap, accepted: a natively routed socket is not
 * `instanceof WebSocket`, since it is a `TauriWebSocket`. `useWebSocket.ts`,
 * the only consumer, never tests for that.
 */
export function createWebSocket(
  webviewWebSocket: typeof globalThis.WebSocket,
  // PascalCase because it is a constructor, not an instance — the same
  // reason `new webviewWebSocket()` never appears below.
  NativeWebSocket: WebSocketCtor = createWebSocketClass(),
): typeof globalThis.WebSocket {
  return new Proxy(webviewWebSocket, {
    construct(target, args, newTarget) {
      const [url, protocols] = args as [string | URL, (string | string[])?]

      if (needsNativeTransport(url)) return new NativeWebSocket(url, protocols)

      // Reflect.construct with the original argument list, so subprotocols
      // (and anything a future spec adds) reach the platform untouched.
      return Reflect.construct(target, args, newTarget)
    },
  })
}
