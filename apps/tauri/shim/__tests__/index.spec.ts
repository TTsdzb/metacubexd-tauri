import type { ShimTarget } from '../index'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { install } from '../index'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-websocket', () => ({
  default: { connect: vi.fn() },
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))

type TestTarget = ShimTarget & {
  __MCXD_PLATFORM__?: string
  __MCXD_IS_DESKTOP__?: boolean
  metacubexd?: { platform: string; isDesktop: boolean }
}

function target(platform?: string, isDesktop?: boolean): TestTarget {
  return {
    fetch: vi.fn(),
    WebSocket: class Original {},
    // A document scoped to this call, not the shared jsdom `document` — so a
    // drag-region listener installed by one case can never fire (against a
    // mocked getCurrentWindow that resolves nothing useful) during another.
    document: document.implementation.createHTMLDocument(),
    __MCXD_PLATFORM__: platform,
    __MCXD_IS_DESKTOP__: isDesktop,
  } as unknown as TestTarget
}

describe('install', () => {
  beforeEach(() => {
    vi.mocked(getCurrentWindow).mockClear()
  })

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

  it('installs a drag-region listener so the frameless window stays movable', () => {
    const global = target('linux', true)
    const addEventListener = vi.spyOn(global.document, 'addEventListener')

    install(global)

    expect(addEventListener).toHaveBeenCalledWith(
      'mousedown',
      expect.any(Function),
    )
  })

  it('binds the captured webview fetch to the original target', async () => {
    const global = target('linux', true)
    // A regular function (not an arrow) so `this` reflects the receiver the
    // wrapped fetch is actually invoked with — a real webview fetch throws
    // "Illegal invocation" if called detached from its receiver, a failure
    // `vi.fn()` alone would never surface.
    global.fetch = vi.fn(function (this: unknown) {
      return Promise.resolve(this)
    }) as unknown as typeof global.fetch

    install(global)
    // Same-origin relative URL: origin.ts routes this to the captured
    // webview fetch rather than the native transport.
    const receiver = await global.fetch('/same-origin')

    expect(receiver).toBe(global)
  })

  it('never touches Tauri bootstrap globals at install time', () => {
    const global = target('linux', true)

    install(global)

    expect(getCurrentWindow).not.toHaveBeenCalled()
  })
})
