import type { TauriWindow } from '../bridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDragRegions } from '../drag'

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))

function fakeWindow() {
  return {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async () => () => {}),
    startDragging: vi.fn(async () => {}),
  } satisfies TauriWindow
}

// Every case installs onto the same jsdom document, so an uninstalled listener
// from an earlier test would still see later events — and, with the
// double-click arbitration below, would swallow dblclicks meant for another
// case. Register each installation for teardown.
const installed: (() => void)[] = []
function install(win: TauriWindow) {
  const uninstall = installDragRegions(document, () => win)
  installed.push(uninstall)
  return uninstall
}
afterEach(() => {
  while (installed.length) installed.pop()!()
})

// Mirrors TitleBar.vue: a draggable strip containing a no-drag button cluster.
function renderTitleBar() {
  document.body.innerHTML = `
    <div id="bar" style="-webkit-app-region: drag">
      <div id="controls" style="-webkit-app-region: no-drag">
        <button id="close"><svg id="icon"></svg></button>
      </div>
    </div>
    <main id="content"></main>
  `
}

// Mirrors what the app ACTUALLY renders under WebKitGTK, which is not what the
// fixture above produces. Vue applies a static `style="..."` through the CSSOM
// rather than setAttribute, and WebKitGTK drops `-webkit-app-region` as
// unrecognized — so in the real window there is no style attribute and no CSS
// declaration. All that survives is the expando Vue's setStyle leaves behind
// when autoPrefix cannot find a supported spelling.
//
// Verified against the running app: attribute null, getPropertyValue '',
// getComputedStyle ''. The innerHTML fixture above sets a real attribute and so
// cannot catch a regression here.
function renderTitleBarAsVueDoes() {
  document.body.innerHTML = `
    <div id="bar">
      <div id="controls">
        <button id="close"><svg id="icon"></svg></button>
      </div>
    </div>
    <main id="content"></main>
  `
  const mark = (id: string, value: string) => {
    const style = document.getElementById(id)!.style as CSSStyleDeclaration &
      Record<string, unknown>
    style['-webkit-app-region'] = value
  }
  mark('bar', 'drag')
  mark('controls', 'no-drag')
}

// A real mousedown always carries a detail (click count) of at least 1;
// default to a single click so callers that don't care about double-click
// behavior still exercise the realistic case.
function mousedown(id: string, button = 0, detail = 1) {
  const target = document.getElementById(id)
  target?.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button,
      detail,
    }),
  )
}

describe('installDragRegions', () => {
  beforeEach(() => renderTitleBar())

  it('starts a drag from a drag region', () => {
    const win = fakeWindow()
    install(win)

    mousedown('bar')

    expect(win.startDragging).toHaveBeenCalledTimes(1)
  })

  it('does not drag from a no-drag descendant', () => {
    const win = fakeWindow()
    install(win)

    mousedown('close')
    mousedown('icon')

    expect(win.startDragging).not.toHaveBeenCalled()
  })

  it('ignores content outside any drag region', () => {
    const win = fakeWindow()
    install(win)

    mousedown('content')

    expect(win.startDragging).not.toHaveBeenCalled()
  })

  it('ignores non-primary buttons so right-click menus still work', () => {
    const win = fakeWindow()
    install(win)

    mousedown('bar', 2)

    expect(win.startDragging).not.toHaveBeenCalled()
  })

  it('stops listening when uninstalled', () => {
    const win = fakeWindow()
    const uninstall = install(win)

    uninstall()
    mousedown('bar')

    expect(win.startDragging).not.toHaveBeenCalled()
  })

  // A frameless window has no native double-click-to-maximize, so
  // TitleBar.vue relies on `@dblclick="toggleMaximize()"`. But
  // startDragging() hands the pointer to the window manager's modal move
  // loop, which swallows the matching mouseup — the webview never sees the
  // click, so `dblclick` never fires. The click-counter branch below is
  // what actually restores double-click-to-maximize.
  it('maximizes on double click instead of dragging', () => {
    const win = fakeWindow()
    install(win)

    mousedown('bar', 0, 2)

    expect(win.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(win.startDragging).not.toHaveBeenCalled()
  })

  it('drags (not maximizes) on a single click', () => {
    const win = fakeWindow()
    install(win)

    mousedown('bar', 0, 1)

    expect(win.startDragging).toHaveBeenCalledTimes(1)
    expect(win.toggleMaximize).not.toHaveBeenCalled()
  })

  it('does nothing on a third click of a triple click', () => {
    const win = fakeWindow()
    install(win)

    mousedown('bar', 0, 3)

    expect(win.startDragging).not.toHaveBeenCalled()
    expect(win.toggleMaximize).not.toHaveBeenCalled()
  })

  // jsdom drops `-webkit-app-region` from the CSSOM the same way WebKitGTK
  // does, so there is no way to make `el.style.getPropertyValue(...)` return
  // a real value here. Spying on it is the only way to exercise the CSSOM
  // branch at all — do not "fix" this into a real assignment, it would
  // silently stop testing anything.
  it('recognizes a drag region applied only through the CSSOM', () => {
    const win = fakeWindow()
    const bar = document.getElementById('bar')!
    bar.removeAttribute('style')
    vi.spyOn(bar.style, 'getPropertyValue').mockReturnValue('drag')
    install(win)

    mousedown('bar')

    expect(win.startDragging).toHaveBeenCalledTimes(1)
  })

  it('recognizes a no-drag region applied only through the CSSOM', () => {
    const win = fakeWindow()
    const controls = document.getElementById('controls')!
    controls.removeAttribute('style')
    vi.spyOn(controls.style, 'getPropertyValue').mockReturnValue('no-drag')
    install(win)

    mousedown('close')

    expect(win.startDragging).not.toHaveBeenCalled()
  })

  it('logs a rejected startDragging instead of swallowing it', async () => {
    const error = new Error('missing core:window:allow-start-dragging')
    const win = fakeWindow()
    win.startDragging.mockRejectedValueOnce(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    install(win)

    mousedown('bar')
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalled()
    })

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('startDragging'),
      error,
    )
    consoleError.mockRestore()
  })
})

// The shape the app actually renders. Every case above builds its DOM with
// innerHTML, which writes a real style attribute — a construction path the
// real app never takes. These pin the expando route instead.
describe('installDragRegions with the marker applied the way Vue applies it', () => {
  beforeEach(() => renderTitleBarAsVueDoes())

  it('sees no style attribute and no CSS declaration, as in the real window', () => {
    const bar = document.getElementById('bar')!
    expect(bar.getAttribute('style')).toBeNull()
    expect(bar.style.getPropertyValue('-webkit-app-region')).toBe('')
  })

  it('still starts a drag from the strip', () => {
    const win = fakeWindow()
    install(win)

    mousedown('bar')

    expect(win.startDragging).toHaveBeenCalledTimes(1)
  })

  it('still maximizes on double click', () => {
    const win = fakeWindow()
    install(win)

    mousedown('bar', 0, 2)

    expect(win.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(win.startDragging).not.toHaveBeenCalled()
  })

  it('still lets the no-drag cluster block a drag', () => {
    const win = fakeWindow()
    install(win)

    mousedown('close')
    mousedown('icon')

    expect(win.startDragging).not.toHaveBeenCalled()
  })

  it('still ignores content outside any region', () => {
    const win = fakeWindow()
    install(win)

    mousedown('content')

    expect(win.startDragging).not.toHaveBeenCalled()
  })
})

// TitleBar.vue puts `@dblclick="!isMac && toggleMaximize()"` on the same strip
// this module handles mousedown for. The branch above assumed the platform's
// modal move loop would eat the mouseup so no dblclick could ever reach it —
// true on Windows, false on GTK, where a double-click maximized and instantly
// restored because both fired.
describe('installDragRegions double-click arbitration', () => {
  beforeEach(() => renderTitleBar())

  // Stands in for the component's own listener, attached to the strip the
  // same way Vue attaches it.
  function titleBarDblClickHandler() {
    const handler = vi.fn()
    document.getElementById('bar')!.addEventListener('dblclick', handler)
    return handler
  }

  function dblclick(id: string) {
    document
      .getElementById(id)!
      .dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
      )
  }

  it('swallows the dblclick that follows its own maximize, so it toggles once', () => {
    const win = fakeWindow()
    const vueHandler = titleBarDblClickHandler()
    install(win)

    mousedown('bar', 0, 2)
    dblclick('bar')

    expect(win.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(vueHandler).not.toHaveBeenCalled()
  })

  it('swallows only one dblclick', () => {
    const win = fakeWindow()
    const vueHandler = titleBarDblClickHandler()
    install(win)

    mousedown('bar', 0, 2)
    dblclick('bar')
    dblclick('bar')

    expect(vueHandler).toHaveBeenCalledTimes(1)
  })

  it('leaves a dblclick alone when it did not handle the maximize itself', () => {
    const win = fakeWindow()
    const vueHandler = titleBarDblClickHandler()
    install(win)

    dblclick('bar')

    expect(vueHandler).toHaveBeenCalledTimes(1)
    expect(win.toggleMaximize).not.toHaveBeenCalled()
  })

  it('clears a stale swallow flag on the next fresh press', () => {
    const win = fakeWindow()
    const vueHandler = titleBarDblClickHandler()
    install(win)

    // A platform that ate the mouseup: our branch ran, no dblclick arrived.
    mousedown('bar', 0, 2)
    // Later, an unrelated interaction.
    mousedown('bar', 0, 1)
    dblclick('bar')

    expect(vueHandler).toHaveBeenCalledTimes(1)
  })

  it('stops listening for dblclick when uninstalled', () => {
    const win = fakeWindow()
    const vueHandler = titleBarDblClickHandler()
    const uninstall = install(win)

    mousedown('bar', 0, 2)
    uninstall()
    dblclick('bar')

    expect(vueHandler).toHaveBeenCalledTimes(1)
  })
})
