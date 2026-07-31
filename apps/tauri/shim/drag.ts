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
 * TitleBar.vue's `@dblclick="toggleMaximize()"` on platforms where
 * `startDragging()` hands the pointer to a modal move loop that swallows the
 * matching mouseup — the webview then never sees a `click`, and so never a
 * `dblclick`. Branching on `event.detail` (Tauri's own drag-region script does
 * the same) covers that: a first click starts a drag, a second toggles
 * maximize, and a third or later does nothing so a triple-click cannot start a
 * fresh drag.
 *
 * That swallowing is platform-dependent, though, and GTK does NOT do it —
 * observed directly: a double-click maximized and instantly restored, because
 * our branch fired on mousedown and then TitleBar.vue's `@dblclick` fired too.
 * So whenever we handle a double click ourselves, the next `dblclick` is
 * swallowed in the capture phase, before it can reach the component's own
 * listener. Where the platform really does eat the mouseup there is simply no
 * `dblclick` to swallow, and the flag is cleared by the next interaction.
 *
 * Returns an uninstall function.
 */
export function installDragRegions(
  doc: Document,
  windowSource: WindowSource = getCurrentWindow,
): () => void {
  // Set when we toggle maximize ourselves, so the platform's own dblclick —
  // which TitleBar.vue also listens for — does not toggle it straight back.
  let swallowNextDblClick = false

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return
    if (event.detail !== 1 && event.detail !== 2) return

    // A fresh press ends any window in which a stale flag could still fire.
    if (event.detail === 1) swallowNextDblClick = false

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
        if (maximize) swallowNextDblClick = true
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

  // Capture phase, so this runs before the listener TitleBar.vue puts on the
  // strip itself and can stop the event reaching it.
  const onDblClick = (event: MouseEvent) => {
    if (!swallowNextDblClick) return
    swallowNextDblClick = false
    event.stopImmediatePropagation()
    event.preventDefault()
  }

  doc.addEventListener('mousedown', onMouseDown)
  doc.addEventListener('dblclick', onDblClick, true)

  return () => {
    doc.removeEventListener('mousedown', onMouseDown)
    doc.removeEventListener('dblclick', onDblClick, true)
  }
}
