import type { ResizeDirection, WindowSource } from './bridge'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Matches the 5px border tao uses for its own undecorated-window hit test, so
// the grab area feels the same as a natively decorated window.
const BORDER = 5
// Corners get a longer reach along each axis, which is what every window
// manager does — a 5x5 corner square is almost impossible to hit.
const CORNER = 16

const CURSORS: Record<ResizeDirection, string> = {
  North: 'n-resize',
  NorthEast: 'ne-resize',
  East: 'e-resize',
  SouthEast: 'se-resize',
  South: 's-resize',
  SouthWest: 'sw-resize',
  West: 'w-resize',
  NorthWest: 'nw-resize',
}

/** Which edge or corner the pointer is over, in viewport coordinates. */
export function directionAt(
  x: number,
  y: number,
  width: number,
  height: number,
): ResizeDirection | null {
  const left = x <= BORDER
  const right = x >= width - BORDER
  const top = y <= BORDER
  const bottom = y >= height - BORDER

  const nearLeft = x <= CORNER
  const nearRight = x >= width - CORNER
  const nearTop = y <= CORNER
  const nearBottom = y >= height - CORNER

  if (top && nearLeft) return 'NorthWest'
  if (top && nearRight) return 'NorthEast'
  if (bottom && nearLeft) return 'SouthWest'
  if (bottom && nearRight) return 'SouthEast'
  if (left && nearTop) return 'NorthWest'
  if (left && nearBottom) return 'SouthWest'
  if (right && nearTop) return 'NorthEast'
  if (right && nearBottom) return 'SouthEast'

  if (top) return 'North'
  if (bottom) return 'South'
  if (left) return 'West'
  if (right) return 'East'
  return null
}

/**
 * Let the user resize the frameless window by dragging its edges.
 *
 * tao already implements this for undecorated windows — `hit_test` plus
 * `begin_resize_drag`, gated on `!is_decorated() && is_resizable() &&
 * !is_maximized()`, all of which hold here. It is unreachable in practice:
 * those handlers are connected to the GtkWindow, and GTK3 propagates button
 * and motion events *upward* from the widget under the pointer. The
 * WebKitWebView fills the window and consumes them, so they never arrive.
 * Any Tauri app with a full-bleed webview and `decorations: false` has the
 * same problem, which is why this has to be driven from JS instead.
 *
 * The mousedown listener is registered in the capture phase so it beats the
 * drag-region handler in `drag.ts`: the top border overlaps the title bar's
 * drag strip, and at the very edge resizing must win over moving.
 *
 * Returns an uninstall function.
 */
export function installResizeHandles(
  doc: Document,
  windowSource: WindowSource = getCurrentWindow,
): () => void {
  // Only restore the cursor if we were the ones who changed it.
  let applied: string | null = null

  const setCursor = (cursor: string | null) => {
    if (applied === cursor) return
    const root = doc.documentElement
    if (cursor) root.style.setProperty('cursor', cursor)
    else root.style.removeProperty('cursor')
    applied = cursor
  }

  const directionFor = (event: MouseEvent): ResizeDirection | null => {
    const view = doc.defaultView
    if (!view) return null
    return directionAt(
      event.clientX,
      event.clientY,
      view.innerWidth,
      view.innerHeight,
    )
  }

  const onMouseMove = (event: MouseEvent) => {
    const direction = directionFor(event)
    setCursor(direction ? (CURSORS[direction] ?? null) : null)
  }

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return
    const direction = directionFor(event)
    if (!direction) return

    // Nothing else should act on a press that starts a resize — not the
    // drag-region handler, and not whatever element happens to sit under the
    // border (a scrollbar track, say).
    event.preventDefault()
    event.stopPropagation()

    void windowSource()
      .startResizeDragging(direction)
      .catch((error: unknown) => {
        console.error('metacubexd resize: startResizeDragging failed', error)
      })
  }

  doc.addEventListener('mousemove', onMouseMove)
  doc.addEventListener('mousedown', onMouseDown, true)

  return () => {
    doc.removeEventListener('mousemove', onMouseMove)
    doc.removeEventListener('mousedown', onMouseDown, true)
    setCursor(null)
  }
}
