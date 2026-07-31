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
      // A rejection here (e.g. a missing `core:window:allow-minimize`
      // capability) would otherwise surface as nothing but an unlabelled
      // "Uncaught (in promise)" in a devtools console nobody has open.
      // Match the websocket.ts convention: log with enough context to
      // identify which control failed rather than let it vanish silently.
      minimize: () =>
        void windowSource()
          .minimize()
          .catch((error: unknown) => {
            console.error('metacubexd bridge: minimize failed', error)
          }),
      toggleMaximize: () =>
        void windowSource()
          .toggleMaximize()
          .catch((error: unknown) => {
            console.error('metacubexd bridge: toggleMaximize failed', error)
          }),
      close: () =>
        void windowSource()
          .close()
          .catch((error: unknown) => {
            console.error('metacubexd bridge: close failed', error)
          }),
      isMaximized: () => windowSource().isMaximized(),

      // Tauri has no maximize/unmaximize event, so derive it: every resize
      // re-reads the flag. The window is resolved once per subscription
      // (not per resize) — by the time a resize handler runs the window is
      // long since resolved, and the install-time laziness guarantee only
      // concerns createBridge() itself.
      onMaximizeChange: (cb) => {
        let disposed = false
        let unlisten: (() => void) | null = null
        // Dedup state: only report actual transitions, since a drag-resize
        // can emit configure events at frame rate and each one would
        // otherwise spawn an IPC round-trip that almost always echoes the
        // same value back. `null` means "nothing reported yet", so the
        // first read after a resize always emits regardless of its value.
        let lastReported: boolean | null = null
        // Sequence guard: if a newer read has started by the time an older
        // one resolves, its answer is stale — drop it so replies can never
        // deliver out of order.
        let sequence = 0

        const win = windowSource()

        void win
          .onResized(() => {
            if (disposed) return

            const mySequence = ++sequence
            void win
              .isMaximized()
              .then((maximized) => {
                if (disposed) return
                if (mySequence !== sequence) return
                if (maximized === lastReported) return
                lastReported = maximized
                try {
                  cb(maximized)
                } catch (error) {
                  // Distinguish a throwing consumer handler from a rejected
                  // platform read: log it the same way a throwing platform
                  // handler would surface, rather than merging both into
                  // one undifferentiated catch.
                  console.error(
                    'metacubexd bridge: onMaximizeChange handler threw',
                    error,
                  )
                }
              })
              .catch((error: unknown) => {
                console.error(
                  'metacubexd bridge: onMaximizeChange failed to read isMaximized',
                  error,
                )
              })
          })
          .then((off) => {
            if (disposed) off()
            else unlisten = off
          })
          .catch((error: unknown) => {
            // If subscribing fails, unlisten stays null and cb never fires
            // again — log it so the maximize control doesn't silently stick
            // at a stale value with no trace of why.
            console.error(
              'metacubexd bridge: onMaximizeChange failed to subscribe to onResized',
              error,
            )
          })

        return () => {
          disposed = true
          unlisten?.()
        }
      },
    },
  }
}
