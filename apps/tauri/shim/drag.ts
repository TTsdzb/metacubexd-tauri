import type { WindowSource } from './bridge'
import { getCurrentWindow } from '@tauri-apps/api/window'

// The -webkit-app-region marker can arrive by either route, depending on
// whether the engine recognizes the property. Vue's compiler turns a static
// `style="..."` into a style object prop and applies it via the CSSOM
// (`@vue/runtime-dom`'s setStyle never calls setAttribute), so the `style`
// content attribute only reflects the declaration back if the engine kept it
// when serializing. An engine that instead drops the unrecognized property
// (as WebKitGTK does) may expose it through one source but not the other, so
// both are checked.
const DRAG = /(?:^|[;\s])(?:-webkit-)?app-region\s*:\s*drag(?![\w-])/i
const NO_DRAG = /(?:^|[;\s])(?:-webkit-)?app-region\s*:\s*no-drag(?![\w-])/i

/** Which region, if any, `el` is marked as — no-drag checked before drag so
 * a no-drag element that (impossibly, given the patterns above) also matched
 * drag would still block. */
function regionOf(el: Element): 'drag' | 'no-drag' | null {
  const attr = el.getAttribute('style')
  const cssom = (el as HTMLElement).style?.getPropertyValue(
    '-webkit-app-region',
  )

  if ((attr && NO_DRAG.test(attr)) || cssom === 'no-drag') return 'no-drag'
  if ((attr && DRAG.test(attr)) || cssom === 'drag') return 'drag'
  return null
}

/**
 * Make `-webkit-app-region: drag` actually drag the window.
 *
 * packages/ui/components/TitleBar.vue is written for Electron, where that CSS
 * property is honored natively. Under wry it does nothing, so the frameless
 * window would be immovable. Walk up from the mousedown target: the nearest
 * marked ancestor wins, which reproduces Electron's nesting semantics (a
 * no-drag button cluster inside a drag strip stays clickable).
 *
 * A plain `startDragging()` on every click would break
 * TitleBar.vue's `@dblclick="toggleMaximize()"`: `startDragging()` hands the
 * pointer to the window manager's modal move loop, which swallows the
 * matching mouseup, so the webview never sees a `click` and therefore never
 * a `dblclick`. Branching on `event.detail` (Tauri's own drag-region script
 * does the same) restores it: a first click starts a drag, a second toggles
 * maximize, and a third (or later) does nothing so a triple-click doesn't
 * start a fresh drag.
 *
 * Returns an uninstall function.
 */
export function installDragRegions(
  doc: Document,
  windowSource: WindowSource = getCurrentWindow,
): () => void {
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return
    if (event.detail !== 1 && event.detail !== 2) return

    for (
      let node = event.target instanceof Element ? event.target : null;
      node && node !== doc.documentElement;
      node = node.parentElement
    ) {
      const region = regionOf(node)
      if (region === 'no-drag') return
      if (region === 'drag') {
        // Prevents the text cursor / selection anchor the mousedown would
        // otherwise leave behind, and stops the page believing a button is
        // still held once the window manager eats the mouseup.
        event.preventDefault()

        const win = windowSource()
        const maximize = event.detail === 2
        void (maximize ? win.toggleMaximize() : win.startDragging()).catch(
          (error: unknown) => {
            console.error(
              `metacubexd drag: ${maximize ? 'toggleMaximize' : 'startDragging'} failed`,
              error,
            )
          },
        )
        return
      }
    }
  }

  doc.addEventListener('mousedown', onMouseDown)

  return () => doc.removeEventListener('mousedown', onMouseDown)
}
