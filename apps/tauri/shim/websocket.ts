import WebSocketPlugin from '@tauri-apps/plugin-websocket'
import { shouldUseNativeTransport } from './origin'

type PluginMessage = {
  type: string
  data: unknown
}

/**
 * WebSocket replacement. Same-origin URLs (Vite HMR in dev) delegate to the
 * native class untouched. Cross-origin URLs (the mihomo backend's
 * connections/traffic/memory/logs sockets) are served by a WebSocket-compatible
 * adapter over the official WebSocket plugin, absorbing two impedance
 * mismatches:
 *
 * 1. Sync constructor, async connect: `new WebSocket(url)` returns immediately
 *    while `WebSocket.connect(url)` returns a promise. The adapter starts in
 *    CONNECTING, buffers send() calls, and dispatches handlers assigned after
 *    construction — which is what the dashboard's useWebSocket.ts does.
 * 2. Message envelope: the plugin delivers `{ type, data }` per frame. Text is
 *    forwarded as a MessageEvent with string data; Binary as a Blob; Ping/Pong
 *    dropped; Close becomes an onclose dispatch so the UI's reconnect-with-
 *    backoff keeps working. A failed connect dispatches onerror then onclose.
 *
 * Lifecycle notes (learned the hard way against a real mihomo):
 * - mihomo's WS server never replies to a client Close frame, so a closed
 *   socket can keep delivering server messages. A browser discards them on a
 *   closed socket; so do we — anything arriving after close() is dropped.
 * - close() may run while the plugin connect is still in flight (the dashboard
 *   switches backends quickly): a socket resolving after close() is
 *   disconnected immediately, never wired.
 */
export function createWebSocket(
  NativeWebSocket: typeof globalThis.WebSocket,
  origin: string,
): typeof globalThis.WebSocket {
  return class TauriWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3

    readonly url: string
    binaryType: BinaryType = 'blob'

    onopen: ((ev: Event) => void) | null = null
    onmessage: ((ev: MessageEvent) => void) | null = null
    onerror: ((ev: Event) => void) | null = null
    onclose: ((ev: CloseEvent) => void) | null = null

    private readyStateValue = TauriWebSocket.CONNECTING
    private listeners = new Map<string, Set<(ev: Event) => void>>()
    private socket: WebSocketPlugin | null = null
    private buffered: string[] = []
    private userClosed = false

    constructor(url: string | URL, _protocols?: string | string[]) {
      this.url = url.toString()
      if (shouldUseNativeTransport(this.url, origin)) {
        // Returning another object from the constructor is legal JavaScript:
        // the call site receives a real native WebSocket with its full API.
        return new NativeWebSocket(
          this.url,
          _protocols,
        ) as unknown as TauriWebSocket
      }
      WebSocketPlugin.connect(this.url)
        .then((socket) => {
          // close() may have been called while the connect was in flight: never
          // wire a socket the user has already closed.
          if (this.userClosed) {
            void socket.disconnect().catch(() => {})
            return
          }
          this.socket = socket
          socket.addListener((msg) => this.handleMessage(msg))
          this.readyStateValue = TauriWebSocket.OPEN
          const event = new Event('open')
          this.dispatch('open', event)
          for (const pending of this.buffered) void socket.send(pending)
          this.buffered = []
        })
        .catch(() => {
          this.readyStateValue = TauriWebSocket.CLOSED
          this.dispatch('error', new Event('error'))
          this.dispatch(
            'close',
            new CloseEvent('close', { code: 1006, reason: '' }),
          )
        })
    }

    get readyState(): number {
      return this.readyStateValue
    }

    addEventListener(type: string, listener: (ev: Event) => void): void {
      const set = this.listeners.get(type) ?? new Set()
      set.add(listener)
      this.listeners.set(type, set)
    }

    removeEventListener(type: string, listener: (ev: Event) => void): void {
      this.listeners.get(type)?.delete(listener)
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (this.readyStateValue === TauriWebSocket.OPEN && this.socket) {
        void this.socket.send(data as string)
      } else {
        this.buffered.push(data as string)
      }
    }

    close(): void {
      this.userClosed = true
      this.readyStateValue = TauriWebSocket.CLOSING
      const socket = this.socket
      this.socket = null
      if (socket) {
        void socket.disconnect().catch(() => {})
      }
      this.readyStateValue = TauriWebSocket.CLOSED
    }

    private handleMessage(msg: PluginMessage): void {
      // mihomo's WS server never replies to a client Close frame, so a closed
      // socket can keep delivering server messages. A browser discards them on
      // a closed socket; so do we.
      if (this.userClosed) return
      switch (msg.type) {
        case 'Text':
          this.dispatch(
            'message',
            new MessageEvent('message', { data: msg.data as string }),
          )
          break
        case 'Binary':
          this.dispatch(
            'message',
            new MessageEvent('message', {
              data: new Blob([new Uint8Array(msg.data as number[])]),
            }),
          )
          break
        case 'Close': {
          const frame = msg.data as { code?: number; reason?: string } | null
          this.readyStateValue = TauriWebSocket.CLOSED
          this.dispatch(
            'close',
            new CloseEvent('close', {
              code: frame?.code ?? 1000,
              reason: frame?.reason ?? '',
              wasClean: !this.userClosed,
            }),
          )
          break
        }
        default:
          // Ping/Pong and anything unknown: nothing the dashboard consumes.
          break
      }
    }

    private dispatch(type: string, event: Event): void {
      const handler =
        type === 'open'
          ? this.onopen
          : type === 'message'
            ? this.onmessage
            : type === 'error'
              ? this.onerror
              : this.onclose
      // The on* properties are typed with their own event interfaces; the
      // dispatch call site widens them to Event.
      if (typeof handler === 'function') (handler as (ev: Event) => void)(event)
      this.listeners.get(type)?.forEach((listener) => listener(event))
    }
  } as unknown as typeof globalThis.WebSocket
}
