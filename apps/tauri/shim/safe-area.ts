const SAFE_AREA_CSS =
  'body{padding-top:env(safe-area-inset-top,0px)!important;padding-bottom:env(safe-area-inset-bottom,0px)!important}'

/**
 * The Android webview draws edge-to-edge under the system bars (the template's
 * MainActivity calls enableEdgeToEdge), so the dashboard's top strip can sit
 * under the notification bar. A browser would inset the viewport; the webview
 * does not. Inject the safe-area padding at document-start — env() evaluates
 * to 0px on every other platform, so desktop is unaffected. The dashboard is
 * upstream-owned and cannot be edited, hence the shim.
 */
export function installSafeAreaPadding(document: Document): void {
  const style = document.createElement('style')
  style.textContent = SAFE_AREA_CSS
  // document-start: <head> may not be parsed yet, <html> always exists.
  document.documentElement.appendChild(style)
}
