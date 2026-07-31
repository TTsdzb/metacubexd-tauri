import type { Message, PluginSocket } from '../websocket'
import { describe, expect, it, vi } from 'vitest'
import { createWebSocketClass } from '../websocket'

vi.mock('@tauri-apps/plugin-websocket', () => ({
  default: { connect: vi.fn() },
}))

// A stand-in for the plugin's socket. `emit` plays the role of the Rust side
// pushing a frame up the channel.
function fakeSocket() {
  const listeners: ((msg: Message) => void)[] = []
  const socket: PluginSocket = {
    addListener: (cb) => {
      listeners.push(cb)
      return () => {}
    },
    send: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  }
  return {
    socket,
    emit: (msg: Message) => listeners.forEach((cb) => cb(msg)),
    sent: socket.send as ReturnType<typeof vi.fn>,
    disconnected: socket.disconnect as ReturnType<typeof vi.fn>,
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
