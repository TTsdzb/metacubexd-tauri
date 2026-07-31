import type { WindowSource } from './bridge'
import { getCurrentWindow } from '@tauri-apps/api/window'

// `-webkit-app-region` is a Chromium property. WebKitGTK does not implement it,
// which costs us every obvious way of reading it — confirmed in the running
// app, where all three of these came back empty on the real title bar:
//
//   getAttribute('style')                        -> null
//   style.getPropertyValue('-webkit-app-region')  -> ''
//   getComputedStyle(el)...                       -> ''
//
// The attribute is null because Vue never writes one: its compiler turns a
// static `style="..."` into a style *object* prop, and `@vue/runtime-dom`'s
// setStyle applies it through the CSSOM, never setAttribute. The CSSOM reads
// are empty because the engine drops a declaration it does not recognize.
//
// What survives is an expando. setStyle asks autoPrefix for a spelling the
// engine supports; autoPrefix tries `WebkitAppRegion`, then Webkit/Moz/ms
// prefixes, finds none, and returns the raw name — so setStyle runs
// `style['-webkit-app-region'] = 'drag'`, which lands as an ordinary JS
// property on the declaration object instead of a CSS declaration.
//
// All three sources are therefore checked: the attribute for markup that set
// it literally, getPropertyValue for engines that do implement the property
// (where Vue would have used the camelized name and set it for real), and the
// expando for the WebKitGTK case, which is the one that actually fires today.
//
// Note the coupling this creates: dragging depends on that autoPrefix
// fallback. A Vue release that switched to setProperty() for unsupported
// properties would break it silently, so re-check the title bar after a major
// Vue upgrade.
const DRAG = /(?:^|[;\s])(?:-webkit-)?app-region\s*:\s*drag(?![\w-])/i
const NO_DRAG = /(?:^|[;\s])(?:-webkit-)?app-region\s*:\s*no-drag(?![\w-])/i

/** The marker's value, from whichever source this engine left it in. */
function markerOf(el: Element): string {
  const style = (el as HTMLElement).style as
    (CSSStyleDeclaration & Record<string, unknown>) | undefined
  if (!style) return ''

  const declared = style.getPropertyValue('-webkit-app-region')
  if (declared) return declared

  const expando = style['-webkit-app-region']
  return typeof expando === 'string' ? expando : ''
}

/** Which region, if any, `el` is marked as — no-drag checked before drag so
 * a no-drag element that (impossibly, given the patterns above) also matched
 * drag would still block. */
function regionOf(el: Element): 'drag' | 'no-drag' | null {
  const attr = el.getAttribute('style')
  const marker = markerOf(el)

  if ((attr && NO_DRAG.test(attr)) || marker === 'no-drag') return 'no-drag'
  if ((attr && DRAG.test(attr)) || marker === 'drag') return 'drag'
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
