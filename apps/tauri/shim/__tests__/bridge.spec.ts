import type { TauriWindow } from '../bridge'
import { describe, expect, it, vi } from 'vitest'
import { createBridge } from '../bridge'

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))

function fakeWindow() {
  let resizeHandler: (() => void) | null = null
  const unlisten = vi.fn()
  const win: TauriWindow = {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => true),
    onResized: vi.fn(async (cb: () => void) => {
      resizeHandler = cb
      return unlisten
    }),
    startDragging: vi.fn(async () => {}),
  }
  return { win, unlisten, resize: () => resizeHandler?.() }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createBridge', () => {
  it('declares itself as the desktop shell with the given platform', () => {
    const { win } = fakeWindow()

    const bridge = createBridge('linux', true, () => win)

    expect(bridge.isDesktop).toBe(true)
    expect(bridge.platform).toBe('linux')
  })

  it('reports a mobile shell as not-desktop, so no title bar is rendered', () => {
    // Rust passes cfg!(desktop) through; on Android that is false and
    // useDesktop() must not render a desktop title bar on a phone.
    const { win } = fakeWindow()

    const bridge = createBridge('android', false, () => win)

    expect(bridge.isDesktop).toBe(false)
    expect(bridge.platform).toBe('android')
  })

  it('omits control and endpoint so the UI stays in hosted-panel mode', () => {
    const { win } = fakeWindow()

    const bridge = createBridge('linux', true, () => win)

    expect('control' in bridge).toBe(false)
    expect('endpoint' in bridge).toBe(false)
    expect('settings' in bridge).toBe(false)
    expect('hotkeys' in bridge).toBe(false)
  })

  it('exposes every window control useDesktop() expects', () => {
    const { win } = fakeWindow()

    const bridge = createBridge('linux', true, () => win)

    expect(Object.keys(bridge.window).sort()).toEqual([
      'close',
      'isMaximized',
      'minimize',
      'onMaximizeChange',
      'toggleMaximize',
    ])
  })

  it('forwards the controls to the Tauri window', async () => {
    const { win } = fakeWindow()
    const bridge = createBridge('linux', true, () => win)

    bridge.window.minimize()
    bridge.window.toggleMaximize()
    bridge.window.close()

    expect(win.minimize).toHaveBeenCalledTimes(1)
    expect(win.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(win.close).toHaveBeenCalledTimes(1)
    expect(await bridge.window.isMaximized()).toBe(true)
  })

  it('reports maximize changes off resize events', async () => {
    const { win, resize } = fakeWindow()
    const bridge = createBridge('linux', true, () => win)
    const seen: boolean[] = []

    bridge.window.onMaximizeChange((maximized) => seen.push(maximized))
    await settle()
    resize()
    await settle()

    expect(seen).toEqual([true])
  })

  it('stops reporting once unsubscribed', async () => {
    const { win, unlisten, resize } = fakeWindow()
    const bridge = createBridge('linux', true, () => win)
    const seen: boolean[] = []

    const off = bridge.window.onMaximizeChange((m) => seen.push(m))
    await settle()
    off()
    resize()
    await settle()

    expect(seen).toEqual([])
    expect(unlisten).toHaveBeenCalledTimes(1)
  })
})
