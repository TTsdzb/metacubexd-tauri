import { getCurrentWindow } from '@tauri-apps/api/window'

/** The slice of Tauri's window API this shim drives. */
export interface TauriWindow {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onResized: (cb: () => void) => Promise<() => void>
  startDragging: () => Promise<void>
}

export type WindowSource = () => TauriWindow

export interface Bridge {
  isDesktop: boolean
  platform: string
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
  }
}

/**
 * Build the `window.metacubexd` object `packages/ui`'s useDesktop() reads.
 *
 * What this omits matters as much as what it provides. No `control` key means
 * resolveControlConfig() falls back to <origin>/api/control, the /info probe
 * fails, and every agent-only surface (kernel lifecycle, profiles,
 * subscriptions, system proxy, TUN, WebDAV backup) hides itself — hosted-panel
 * mode, reached by omission rather than by deleting UI. No `endpoint` key means
 * no managed local backend is seeded. No `settings`/`hotkeys` keys means the
 * Desktop section of the control page stays hidden.
 *
 * `isDesktop` comes from Rust's `cfg!(desktop)` rather than being hardcoded.
 * On Android it is false, which is what keeps useDesktop() from rendering a
 * desktop title bar and its window controls on a phone.
 *
 * The window is resolved lazily on each call so nothing touches
 * window.__TAURI_INTERNALS__ at install time.
 */
export function createBridge(
  platform: string,
  isDesktop: boolean,
  windowSource: WindowSource = getCurrentWindow,
): Bridge {
  return {
    isDesktop,
    platform,
    window: {
      minimize: () => void windowSource().minimize(),
      toggleMaximize: () => void windowSource().toggleMaximize(),
      close: () => void windowSource().close(),
      isMaximized: () => windowSource().isMaximized(),

      // Tauri has no maximize/unmaximize event, so derive it: every resize
      // re-reads the flag. useWindowControls() only needs the current value.
      onMaximizeChange: (cb) => {
        let disposed = false
        let unlisten: (() => void) | null = null

        void windowSource()
          .onResized(() => {
            if (disposed) return
            void windowSource()
              .isMaximized()
              .then((maximized) => {
                if (!disposed) cb(maximized)
              })
              .catch(() => {})
          })
          .then((off) => {
            if (disposed) off()
            else unlisten = off
          })
          .catch(() => {})

        return () => {
          disposed = true
          unlisten?.()
        }
      },
    },
  }
}
