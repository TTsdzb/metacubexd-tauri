import { describe, expect, it, vi } from 'vitest'
import { install } from '../index'

describe('install', () => {
  it('patches fetch and WebSocket, then is idempotent', () => {
    const originalFetch = vi.fn()
    const originalWebSocket =
      class NativeWebSocket {} as unknown as typeof globalThis.WebSocket
    const target = {
      fetch: originalFetch as unknown as typeof globalThis.fetch,
      WebSocket: originalWebSocket,
    }

    install(target, 'http://tauri.localhost')
    const patchedFetch = target.fetch
    const patchedWebSocket = target.WebSocket
    expect(patchedFetch).not.toBe(originalFetch)
    expect(patchedWebSocket).not.toBe(originalWebSocket)

    install(target, 'http://tauri.localhost')
    expect(target.fetch).toBe(patchedFetch)
    expect(target.WebSocket).toBe(patchedWebSocket)
  })
})
