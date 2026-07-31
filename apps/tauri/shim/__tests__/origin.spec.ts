import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('is sensitive to port, not just hostname, on a same-machine backend', () => {
    // Same hostname as the dev origin (localhost) but a different port: this
    // is the canonical same-machine Mihomo deployment. A hostname-only
    // comparison would wrongly keep these on the webview transport, where
    // the dev origin's port (3000) mismatch would then break on CORS.
    expect(needsNativeTransport('http://localhost:9090/version')).toBe(true)
    expect(needsNativeTransport('ws://localhost:9090/traffic')).toBe(true)
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

// The dev-server origin above is a convenient stand-in, but it is not what
// the shipped binary actually serves the page from. Exercise the two real
// production origins so a fix that only special-cases localhost:3000 cannot
// pass silently.
describe('needsNativeTransport at production origins', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('on Linux/Windows (http://tauri.localhost)', () => {
    beforeEach(() => {
      vi.stubGlobal('location', {
        href: 'http://tauri.localhost/',
        origin: 'http://tauri.localhost',
        host: 'tauri.localhost',
        protocol: 'http:',
      })
    })

    it('keeps relative URLs and same-origin assets on the webview transport', () => {
      expect(needsNativeTransport('assets/app.js')).toBe(false)
      expect(needsNativeTransport('http://tauri.localhost/assets/app.js')).toBe(
        false,
      )
    })

    it('routes a cross-origin http backend natively', () => {
      expect(needsNativeTransport('http://192.168.1.5:9090/version')).toBe(true)
    })

    it('routes ws://localhost:9090 natively', () => {
      expect(needsNativeTransport('ws://localhost:9090/traffic')).toBe(true)
    })
  })

  describe('on macOS (tauri://localhost)', () => {
    beforeEach(() => {
      vi.stubGlobal('location', {
        href: 'tauri://localhost/',
        origin: 'tauri://localhost',
        host: 'localhost',
        protocol: 'tauri:',
      })
    })

    it('keeps relative URLs and same-origin assets on the webview transport', () => {
      // Resolves against the tauri: page href, so the parsed URL's protocol
      // is tauri: too — never in NATIVE_PROTOCOLS, so it never reaches (and
      // does not need) a same-origin check.
      expect(needsNativeTransport('assets/app.js')).toBe(false)
      expect(needsNativeTransport('tauri://localhost/assets/app.js')).toBe(
        false,
      )
    })

    it('routes a cross-origin http backend natively', () => {
      expect(needsNativeTransport('http://192.168.1.5:9090/version')).toBe(true)
    })

    it('routes ws://localhost:9090 natively', () => {
      expect(needsNativeTransport('ws://localhost:9090/traffic')).toBe(true)
    })

    it('routes ws://localhost/traffic natively', () => {
      // Regression case: the page's own host is "localhost" here, but there
      // is no same-origin socket to protect off a tauri: page — the page
      // isn't http(s), so no ws:/wss: URL can ever be "the same origin" as
      // it. A host-only comparison would wrongly match this to the page and
      // keep it on the webview transport, where WebKit blocks plain ws:
      // from a custom-protocol origin it treats as secure.
      expect(needsNativeTransport('ws://localhost/traffic')).toBe(true)
    })
  })
})
