import { describe, expect, it, vi } from 'vitest'
import { install } from '../index'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-websocket', () => ({
  default: { connect: vi.fn() },
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))

function target(platform?: string, isDesktop?: boolean) {
  return {
    fetch: vi.fn(),
    WebSocket: class Original {},
    document,
    __MCXD_PLATFORM__: platform,
    __MCXD_IS_DESKTOP__: isDesktop,
  } as unknown as typeof globalThis & {
    __MCXD_PLATFORM__?: string
    __MCXD_IS_DESKTOP__?: boolean
    metacubexd?: { platform: string; isDesktop: boolean }
  }
}

describe('install', () => {
  it('replaces fetch and WebSocket and publishes the bridge', () => {
    const global = target('linux', true)
    const originalFetch = global.fetch
    const OriginalWebSocket = global.WebSocket

    install(global)

    expect(global.fetch).not.toBe(originalFetch)
    expect(global.WebSocket).not.toBe(OriginalWebSocket)
    expect(global.metacubexd?.platform).toBe('linux')
    expect(global.metacubexd?.isDesktop).toBe(true)
  })

  it('passes a mobile shell flag through to the bridge', () => {
    const global = target('android', false)

    install(global)

    expect(global.metacubexd?.isDesktop).toBe(false)
  })

  it('is idempotent, so a re-run cannot double-wrap fetch', () => {
    const global = target('linux', true)

    install(global)
    const patched = global.fetch
    install(global)

    expect(global.fetch).toBe(patched)
  })

  it('falls back to linux/desktop when Rust injected no prelude', () => {
    const global = target(undefined, undefined)

    install(global)

    expect(global.metacubexd?.platform).toBe('linux')
    expect(global.metacubexd?.isDesktop).toBe(true)
  })
})
