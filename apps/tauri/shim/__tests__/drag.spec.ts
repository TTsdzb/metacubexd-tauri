import type { TauriWindow } from '../bridge'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

function mousedown(id: string, button = 0) {
  const target = document.getElementById(id)
  target?.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true, button }),
  )
}

describe('installDragRegions', () => {
  beforeEach(() => renderTitleBar())

  it('starts a drag from a drag region', () => {
    const win = fakeWindow()
    installDragRegions(document, () => win)

    mousedown('bar')

    expect(win.startDragging).toHaveBeenCalledTimes(1)
  })

  it('does not drag from a no-drag descendant', () => {
    const win = fakeWindow()
    installDragRegions(document, () => win)

    mousedown('close')
    mousedown('icon')

    expect(win.startDragging).not.toHaveBeenCalled()
  })

  it('ignores content outside any drag region', () => {
    const win = fakeWindow()
    installDragRegions(document, () => win)

    mousedown('content')

    expect(win.startDragging).not.toHaveBeenCalled()
  })

  it('ignores non-primary buttons so right-click menus still work', () => {
    const win = fakeWindow()
    installDragRegions(document, () => win)

    mousedown('bar', 2)

    expect(win.startDragging).not.toHaveBeenCalled()
  })

  it('stops listening when uninstalled', () => {
    const win = fakeWindow()
    const uninstall = installDragRegions(document, () => win)

    uninstall()
    mousedown('bar')

    expect(win.startDragging).not.toHaveBeenCalled()
  })
})
