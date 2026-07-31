import type { Incoming, PluginSocket } from '../websocket'
import { describe, expect, it, vi } from 'vitest'
import { createWebSocketClass } from '../websocket'

vi.mock('@tauri-apps/plugin-websocket', () => ({
  default: { connect: vi.fn() },
}))

// A stand-in for the plugin's socket. `emit` plays the role of the Rust side
// pushing a frame — or, per `Incoming`, an untagged error string or a raw
// `null` frame — up the channel. `unlisten` is the disposer `addListener`
// hands back; tests assert it gets called so a finished socket doesn't keep
// its handler graph alive.
function fakeSocket(options: { disconnectRejects?: boolean } = {}) {
  const listeners: ((msg: Incoming) => void)[] = []
  const unlisten = vi.fn()
  const socket: PluginSocket = {
    addListener: (cb) => {
      listeners.push(cb)
      return unlisten
    },
    send: vi.fn(async () => {}),
    disconnect: options.disconnectRejects
      ? vi.fn(async () => {
          throw new Error('ConnectionNotFound')
        })
      : vi.fn(async () => {}),
  }
  return {
    socket,
    emit: (msg: Incoming) => listeners.forEach((cb) => cb(msg)),
    sent: socket.send as ReturnType<typeof vi.fn>,
    disconnected: socket.disconnect as ReturnType<typeof vi.fn>,
    unlisten,
  }
}

// Let the constructor's pending connect() promise settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createWebSocketClass', () => {
  it('starts CONNECTING and reaches OPEN once connected', async () => {
    const { socket } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)

    const ws = new Ctor('ws://192.168.1.5:9090/traffic')
    expect(ws.readyState).toBe(0)
    expect(ws.url).toBe('ws://192.168.1.5:9090/traffic')

    await settle()
    expect(ws.readyState).toBe(1)
  })

  it('connects to the url it was constructed with', async () => {
    const { socket } = fakeSocket()
    const connect = vi.fn(async () => socket)
    const Ctor = createWebSocketClass(connect)

    // `new` here is only for its connect() side effect. The repo's eslint
    // config enforces `no-new`; `void` documents that discarding the
    // instance is intentional rather than a mistake.
    void new Ctor('ws://192.168.1.5:9090/logs?token=abc')
    await settle()

    expect(connect).toHaveBeenCalledWith('ws://192.168.1.5:9090/logs?token=abc')
  })

  it('delivers Text frames to an onmessage assigned after construction', async () => {
    const { socket, emit } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)
    const ws = new Ctor('ws://host/traffic')
    const received: unknown[] = []
    ws.onmessage = (event) => received.push(event.data)

    await settle()
    emit({ type: 'Text', data: '{"up":1,"down":2}' })

    expect(received).toEqual(['{"up":1,"down":2}'])
  })

  it('decodes Binary frames to text, because the UI JSON.parses event.data', async () => {
    const { socket, emit } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)
    const ws = new Ctor('ws://host/traffic')
    const received: unknown[] = []
    ws.onmessage = (event) => received.push(event.data)

    await settle()
    emit({ type: 'Binary', data: [...new TextEncoder().encode('{"up":3}')] })

    expect(received).toEqual(['{"up":3}'])
  })

  it('ignores Ping and Pong frames', async () => {
    const { socket, emit } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)
    const ws = new Ctor('ws://host/traffic')
    const onmessage = vi.fn()
    ws.onmessage = onmessage

    await settle()
    emit({ type: 'Ping', data: [] })
    emit({ type: 'Pong', data: [] })

    expect(onmessage).not.toHaveBeenCalled()
  })

  it('turns a Close frame into onclose, so the UI reconnect logic fires', async () => {
    const { socket, emit } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)
    const ws = new Ctor('ws://host/traffic')
    const onclose = vi.fn()
    ws.onclose = onclose

    await settle()
    emit({ type: 'Close', data: { code: 1006, reason: 'kernel restarted' } })

    expect(onclose).toHaveBeenCalledTimes(1)
    expect(onclose.mock.calls[0]?.[0]).toMatchObject({
      code: 1006,
      reason: 'kernel restarted',
    })
    expect(ws.readyState).toBe(3)
  })

  it("treats an untagged string payload (the plugin's read-error channel) as an abnormal close", async () => {
    const { socket, emit } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)
    const ws = new Ctor('ws://host/traffic')
    const order: string[] = []
    ws.onerror = () => order.push('error')
    ws.onclose = () => order.push('close')

    await settle()
    // This is what tokio-tungstenite's read loop actually pushes on a read
    // error — `Error`'s Serialize impl is a bare string, not a tagged
    // `Message`. This is the *common* kernel-restart path: Mihomo's process
    // exit drops the TCP connection with no close handshake, so the plugin
    // never emits `Ok(Message::Close(..))`.
    emit('Connection reset without closing handshake')

    expect(order).toEqual(['error', 'close'])
    expect(ws.readyState).toBe(3)
  })

  it("handles a null payload (the plugin's raw-frame case) as an abnormal close without throwing", async () => {
    const { socket, emit } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)
    const ws = new Ctor('ws://host/traffic')
    const onclose = vi.fn()
    ws.onclose = onclose

    await settle()
    expect(() => emit(null)).not.toThrow()

    expect(onclose).toHaveBeenCalledTimes(1)
    expect(ws.readyState).toBe(3)
  })

  it('reports a failed connect as error then close', async () => {
    const Ctor = createWebSocketClass(async () => {
      throw new Error('connection refused')
    })
    const ws = new Ctor('ws://host/traffic')
    const order: string[] = []
    ws.onerror = () => order.push('error')
    ws.onclose = () => order.push('close')

    await settle()

    expect(order).toEqual(['error', 'close'])
    expect(ws.readyState).toBe(3)
  })

  it('disconnects the socket on close() and fires onclose once', async () => {
    const { socket, disconnected } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)
    const ws = new Ctor('ws://host/traffic')
    const onclose = vi.fn()
    ws.onclose = onclose

    await settle()
    ws.close()
    await settle()
    ws.close()
    await settle()

    expect(disconnected).toHaveBeenCalledTimes(1)
    expect(onclose).toHaveBeenCalledTimes(1)
    expect(ws.readyState).toBe(3)
  })

  it('still fires onclose when disconnect() rejects, e.g. ConnectionNotFound on an already-gone connection', async () => {
    const { socket, disconnected } = fakeSocket({ disconnectRejects: true })
    const Ctor = createWebSocketClass(async () => socket)
    const ws = new Ctor('ws://host/traffic')
    const onclose = vi.fn()
    ws.onclose = onclose

    await settle()
    ws.close()
    await settle()

    expect(disconnected).toHaveBeenCalledTimes(1)
    expect(onclose).toHaveBeenCalledTimes(1)
    expect(ws.readyState).toBe(3)
  })

  it('unsubscribes the plugin listener once the socket finishes', async () => {
    const { socket, unlisten } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)
    const ws = new Ctor('ws://host/traffic')

    await settle()
    expect(unlisten).not.toHaveBeenCalled()

    ws.close()
    await settle()

    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('does not deliver frames after close(), matching intentional teardown', async () => {
    const { socket, emit } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)
    const ws = new Ctor('ws://host/traffic')
    await settle()
    const onmessage = vi.fn()
    ws.onmessage = onmessage

    ws.close()
    await settle()
    emit({ type: 'Text', data: 'late' })

    expect(onmessage).not.toHaveBeenCalled()
  })

  it('disconnects immediately when close() beats the connect promise', async () => {
    const { socket, disconnected } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)

    const ws = new Ctor('ws://host/traffic')
    ws.close()
    await settle()

    expect(disconnected).toHaveBeenCalledTimes(1)
    expect(ws.readyState).toBe(3)
  })

  it('buffers sends issued while CONNECTING and flushes them on open', async () => {
    const { socket, sent } = fakeSocket()
    const Ctor = createWebSocketClass(async () => socket)

    const ws = new Ctor('ws://host/traffic')
    ws.send('early')
    expect(sent).not.toHaveBeenCalled()

    await settle()
    expect(sent).toHaveBeenCalledWith('early')

    ws.send('later')
    expect(sent).toHaveBeenCalledWith('later')
  })
})
