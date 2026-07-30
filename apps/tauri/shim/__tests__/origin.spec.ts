import { describe, expect, it } from 'vitest'
import { needsNativeTransport } from '../origin'

// jsdom serves these specs from http://localhost:3000/ (vitest.config.ts),
// standing in for the Nuxt dev server.
describe('needsNativeTransport', () => {
  it('keeps relative URLs on the webview transport', () => {
    expect(needsNativeTransport('proxies')).toBe(false)
    expect(needsNativeTransport('/config.js')).toBe(false)
  })

  it('keeps same-origin absolute URLs on the webview transport', () => {
    expect(needsNativeTransport('http://localhost:3000/api/control/info')).toBe(
      false,
    )
  })

  it("keeps Vite's HMR socket on the webview transport", () => {
    // URL.origin serializes ws: as "ws://localhost:3000", which never equals
    // location.origin ("http://localhost:3000"). Comparing hosts, not origins,
    // is what keeps HMR working.
    expect(needsNativeTransport('ws://localhost:3000/_nuxt/hmr')).toBe(false)
  })

  it('routes a cross-origin backend natively', () => {
    expect(needsNativeTransport('http://192.168.1.5:9090/version')).toBe(true)
    expect(needsNativeTransport('ws://192.168.1.5:9090/traffic')).toBe(true)
    expect(needsNativeTransport('wss://example.com/logs')).toBe(true)
    expect(needsNativeTransport('https://api.github.com/repos/a/b')).toBe(true)
  })

  it('accepts URL instances', () => {
    expect(needsNativeTransport(new URL('http://192.168.1.5:9090/'))).toBe(true)
  })

  it('leaves non-network schemes alone', () => {
    expect(needsNativeTransport('blob:http://localhost:3000/abc')).toBe(false)
    expect(needsNativeTransport('data:text/plain,hello')).toBe(false)
  })

  it('leaves unparseable input to the platform implementation', () => {
    expect(needsNativeTransport('http://[malformed')).toBe(false)
  })
})
