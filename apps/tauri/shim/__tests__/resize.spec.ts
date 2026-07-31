import type { TauriWindow } from '../bridge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { directionAt, installResizeHandles } from '../resize'

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))

function fakeWindow() {
  return {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async () => () => {}),
    startDragging: vi.fn(async () => {}),
    startResizeDragging: vi.fn(async () => {}),
  } satisfies TauriWindow
}

// Installs share one jsdom document, so a listener left behind by an earlier
// case would keep seeing events — and this module stops propagation, so a
// stray one would swallow presses meant for another test.
const installed: (() => void)[] = []
function install(win: TauriWindow) {
  const uninstall = installResizeHandles(document, () => win)
  installed.push(uninstall)
  return uninstall
}
afterEach(() => {
  while (installed.length) installed.pop()!()
})

// jsdom's default viewport.
const W = window.innerWidth
const H = window.innerHeight

function press(x: number, y: number, button = 0) {
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  })
  document.body.dispatchEvent(event)
  return event
}

function move(x: number, y: number) {
  document.body.dispatchEvent(
    new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }),
  )
}

describe('directionAt', () => {
  it('names each edge', () => {
    expect(directionAt(400, 1, W, H)).toBe('North')
    expect(directionAt(400, H - 1, W, H)).toBe('South')
    expect(directionAt(1, 400, W, H)).toBe('West')
    expect(directionAt(W - 1, 400, W, H)).toBe('East')
  })

  it('names each corner, reaching further along both axes than the border', () => {
    expect(directionAt(1, 1, W, H)).toBe('NorthWest')
    expect(directionAt(W - 1, 1, W, H)).toBe('NorthEast')
    expect(directionAt(1, H - 1, W, H)).toBe('SouthWest')
    expect(directionAt(W - 1, H - 1, W, H)).toBe('SouthEast')

    // 12px along the edge is still corner territory, not a plain edge.
    expect(directionAt(12, 2, W, H)).toBe('NorthWest')
    expect(directionAt(2, 12, W, H)).toBe('NorthWest')
  })

  it('returns null anywhere else, so ordinary content is untouched', () => {
    expect(directionAt(400, 300, W, H)).toBeNull()
    expect(directionAt(50, 50, W, H)).toBeNull()
  })
})

describe('installResizeHandles', () => {
  it('starts a resize when a border is pressed', () => {
    const win = fakeWindow()
    install(win)

    press(W - 1, 300)

    expect(win.startResizeDragging).toHaveBeenCalledWith('East')
  })

  it('ignores presses in the content area', () => {
    const win = fakeWindow()
    install(win)

    press(400, 300)

    expect(win.startResizeDragging).not.toHaveBeenCalled()
  })

  it('ignores non-primary buttons', () => {
    const win = fakeWindow()
    install(win)

    press(W - 1, 300, 2)

    expect(win.startResizeDragging).not.toHaveBeenCalled()
  })

  // The top border sits on top of the title bar's drag strip. Resizing has to
  // win there, or the window moves when the user meant to resize it.
  it('stops the press propagating, so the drag handler cannot also act', () => {
    const win = fakeWindow()
    const alsoOnDocument = vi.fn()
    document.addEventListener('mousedown', alsoOnDocument)
    install(win)

    const event = press(400, 1)

    expect(win.startResizeDragging).toHaveBeenCalledWith('North')
    expect(alsoOnDocument).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    document.removeEventListener('mousedown', alsoOnDocument)
  })

  it('shows a resize cursor over a border and clears it on the way out', () => {
    const win = fakeWindow()
    install(win)

    move(W - 1, 300)
    expect(document.documentElement.style.cursor).toBe('e-resize')

    move(400, 300)
    expect(document.documentElement.style.cursor).toBe('')
  })

  it('restores the cursor when uninstalled', () => {
    const win = fakeWindow()
    const uninstall = install(win)

    move(1, 1)
    expect(document.documentElement.style.cursor).toBe('nw-resize')

    uninstall()
    expect(document.documentElement.style.cursor).toBe('')
  })

  it('stops listening when uninstalled', () => {
    const win = fakeWindow()
    const uninstall = install(win)

    uninstall()
    press(W - 1, 300)

    expect(win.startResizeDragging).not.toHaveBeenCalled()
  })

  it('logs a rejected startResizeDragging instead of swallowing it', async () => {
    const error = new Error('missing core:window:allow-start-resize-dragging')
    const win = fakeWindow()
    win.startResizeDragging.mockRejectedValueOnce(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    install(win)

    press(W - 1, 300)
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalled()
    })

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('startResizeDragging'),
      error,
    )
    consoleError.mockRestore()
  })
})
