import PluginWebSocket from '@tauri-apps/plugin-websocket'

/** The frame shape `tauri-plugin-websocket` pushes up its channel. */
export type Message =
  | { type: 'Text'; data: string }
  | { type: 'Binary'; data: number[] }
  | { type: 'Ping'; data: number[] }
  | { type: 'Pong'; data: number[] }
  | { type: 'Close'; data: { code: number; reason: string } | null }

/** The slice of the plugin's socket this adapter drives. */
export interface PluginSocket {
  addListener: (cb: (msg: Message) => void) => () => void
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

    constructor(url: string | URL, _protocols?: string | string[]) {
      this.url = String(url)
      void this.#open()
    }

    async #open(): Promise<void> {
      let socket: PluginSocket
      try {
        socket = await connect(this.url)
      } catch (error) {
        this.onerror?.(new Event('error'))
        this.#finish(1006, String(error))
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
      socket.addListener((message) => this.#receive(message))

      for (const message of this.#pending.splice(0)) {
        void socket.send(message).catch(() => {})
      }

      this.onopen?.(new Event('open'))
    }

    #receive(message: Message): void {
      if (this.readyState !== OPEN) return

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
      }
    }

    #finish(code: number, reason: string): void {
      if (this.readyState === CLOSED) return
      this.readyState = CLOSED
      this.#socket = null
      this.#pending = []
      this.onclose?.(
        new CloseEvent('close', { code, reason, wasClean: code === 1000 }),
      )
    }

    send(data: string): void {
      if (this.readyState === CLOSING || this.readyState === CLOSED) return

      const message = String(data)
      const socket = this.#socket
      if (!socket) {
        // Still CONNECTING. The platform WebSocket throws here; buffering is
        // friendlier and matches how callers actually expect it to behave.
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
        .catch(() => {})
        .finally(() => this.#finish(code, reason))
    }
  }
}
