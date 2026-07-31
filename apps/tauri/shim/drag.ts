import type { WindowSource } from './bridge'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Matched against the raw inline style attribute rather than the CSSOM:
// -webkit-app-region is an Electron/WKWebView property, and WebKitGTK drops
// properties it does not recognize, so style.getPropertyValue() returns ''.
const DRAG = /(?:^|[;\s])(?:-webkit-)?app-region\s*:\s*drag/i
const NO_DRAG = /(?:^|[;\s])(?:-webkit-)?app-region\s*:\s*no-drag/i

/**
 * Make `-webkit-app-region: drag` actually drag the window.
 *
 * packages/ui/components/TitleBar.vue is written for Electron, where that CSS
 * property is honored natively. Under wry it does nothing, so the frameless
 * window would be immovable. Walk up from the mousedown target: the nearest
 * marked ancestor wins, which reproduces Electron's nesting semantics (a
 * no-drag button cluster inside a drag strip stays clickable).
 *
 * Returns an uninstall function.
 */
export function installDragRegions(
  doc: Document,
  windowSource: WindowSource = getCurrentWindow,
): () => void {
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return

    for (
      let node = event.target as Element | null;
      node && node !== doc.documentElement;
      node = node.parentElement
    ) {
      const style = node.getAttribute?.('style')
      if (!style) continue
      if (NO_DRAG.test(style)) return
      if (DRAG.test(style)) {
        void windowSource()
          .startDragging()
          .catch(() => {})
        return
      }
    }
  }

  doc.addEventListener('mousedown', onMouseDown)

  return () => doc.removeEventListener('mousedown', onMouseDown)
}
