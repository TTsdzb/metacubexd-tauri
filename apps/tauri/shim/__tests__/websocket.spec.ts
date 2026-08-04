import { beforeEach, describe, expect, it, vi } from 'vitest'

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }))

vi.mock('@tauri-apps/plugin-websocket', () => ({
  default: { connect: (...args: unknown[]) => connectMock(...args) },
}))

import { createWebSocket } from '../websocket'

const ORIGIN = 'http://tauri.localhost'

class MockSocket {
  listener: ((msg: unknown) => void) | null = null
  addListener = vi.fn((cb: (msg: unknown) => void) => {
    this.listener = cb
    return () => {
      this.listener = null
    }
  })
  send = vi.fn()
  disconnect = vi.fn(async () => {})
}

function makeShim() {
  class NativeWebSocket {
    readonly url: string
    constructor(url: string) {
      this.url = url
    }
  }
  return {
    NativeWebSocket,
    Shim: createWebSocket(
      NativeWebSocket as unknown as typeof globalThis.WebSocket,
      ORIGIN,
    ),
  }
}

describe('createWebSocket', () => {
  let socket: MockSocket

  beforeEach(() => {
    socket = new MockSocket()
    connectMock.mockReset()
    connectMock.mockResolvedValue(socket)
  })

  it('delegates same-origin connections to the native WebSocket', () => {
    const { NativeWebSocket, Shim } = makeShim()
    const ws = new Shim('ws://tauri.localhost/hmr')
    expect(ws).toBeInstanceOf(NativeWebSocket)
    expect(connectMock).not.toHaveBeenCalled()
  })

  it('routes cross-origin connections to the plugin and reaches OPEN', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections?token=x')
    expect(ws.readyState).toBe(0) // CONNECTING
    expect(connectMock).toHaveBeenCalledWith(
      'ws://192.168.1.5:9090/connections?token=x',
    )
    await vi.waitFor(() => expect(ws.readyState).toBe(1)) // OPEN
  })

  it('buffers send() until the connection is open, then flushes', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/traffic')
    ws.send('buffered')
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    ws.send('live')
    expect(socket.send).toHaveBeenCalledWith('buffered')
    expect(socket.send).toHaveBeenCalledWith('live')
  })

  it('forwards Text messages to onmessage with string data', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    const onmessage = vi.fn()
    ws.onmessage = onmessage
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    socket.listener?.({ type: 'Text', data: '{"up":123}' })
    expect(onmessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: '{"up":123}' }),
    )
  })

  it('ignores Ping and Pong frames', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    const onmessage = vi.fn()
    ws.onmessage = onmessage
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    socket.listener?.({ type: 'Ping', data: [1] })
    socket.listener?.({ type: 'Pong', data: [1] })
    expect(onmessage).not.toHaveBeenCalled()
  })

  it('turns a Close frame into onclose and CLOSED', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    const onclose = vi.fn()
    ws.onclose = onclose
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    socket.listener?.({ type: 'Close', data: { code: 1006, reason: 'gone' } })
    expect(onclose).toHaveBeenCalledWith(
      expect.objectContaining({ code: 1006, reason: 'gone' }),
    )
    expect(ws.readyState).toBe(3) // CLOSED
  })

  it('dispatches onerror then onclose when the connect fails', async () => {
    connectMock.mockRejectedValue(new Error('connection refused'))
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    const onerror = vi.fn()
    const onclose = vi.fn()
    ws.onerror = onerror
    ws.onclose = onclose
    await vi.waitFor(() => expect(ws.readyState).toBe(3))
    expect(onerror).toHaveBeenCalled()
    expect(onclose).toHaveBeenCalled()
  })

  it('close() disconnects the plugin socket', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    ws.close()
    expect(socket.disconnect).toHaveBeenCalled()
  })

  it('discards messages that arrive after close()', async () => {
    // mihomo's WS server never replies to a client Close frame, so a closed
    // socket can keep delivering messages from the server. A browser discards
    // them on a closed socket; the adapter must do the same.
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    const onmessage = vi.fn()
    ws.onmessage = onmessage
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    ws.close()
    socket.listener?.({ type: 'Text', data: '{"up":1}' })
    socket.listener?.({ type: 'Text', data: '{"up":2}' })
    expect(onmessage).not.toHaveBeenCalled()
    expect(ws.readyState).toBe(3)
  })

  it('disconnects a socket that resolves after close()', async () => {
    let resolveConnect!: (s: MockSocket) => void
    connectMock.mockReturnValue(
      new Promise((resolve) => {
        resolveConnect = resolve
      }),
    )
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    const onopen = vi.fn()
    ws.onopen = onopen
    ws.close()
    const late = new MockSocket()
    resolveConnect(late)
    await vi.waitFor(() => expect(late.disconnect).toHaveBeenCalled())
    expect(onopen).not.toHaveBeenCalled()
    expect(ws.readyState).toBe(3)
  })
})
