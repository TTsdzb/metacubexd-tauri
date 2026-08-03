import { describe, expect, it } from 'vitest'
import { shouldUseNativeTransport } from '../origin'

const ORIGIN = 'http://tauri.localhost'

describe('shouldUseNativeTransport', () => {
  it('keeps relative URLs on the native path', () => {
    expect(shouldUseNativeTransport('/_nuxt/entry.js', ORIGIN)).toBe(true)
    expect(shouldUseNativeTransport('config.js', ORIGIN)).toBe(true)
  })

  it('keeps same-origin absolute URLs on the native path', () => {
    expect(
      shouldUseNativeTransport('http://tauri.localhost/config.js', ORIGIN),
    ).toBe(true)
  })

  it('routes cross-origin HTTP URLs to the plugin', () => {
    expect(
      shouldUseNativeTransport('http://192.168.1.5:9090/proxies', ORIGIN),
    ).toBe(false)
    expect(
      shouldUseNativeTransport(
        'https://api.github.com/repos/x/y/releases',
        ORIGIN,
      ),
    ).toBe(false)
  })

  it('treats ws/wss with the same host and port as native (dev HMR)', () => {
    expect(shouldUseNativeTransport('ws://tauri.localhost/hmr', ORIGIN)).toBe(
      true,
    )
  })

  it('routes cross-origin WebSockets to the plugin', () => {
    expect(
      shouldUseNativeTransport(
        'ws://192.168.1.5:9090/connections?token=x',
        ORIGIN,
      ),
    ).toBe(false)
  })

  it('keeps blob: and data: URLs on the native path', () => {
    expect(
      shouldUseNativeTransport('blob:http://tauri.localhost/uuid', ORIGIN),
    ).toBe(true)
    expect(
      shouldUseNativeTransport('data:text/plain;base64,QQ==', ORIGIN),
    ).toBe(true)
  })

  it('falls back to native for malformed URLs', () => {
    expect(shouldUseNativeTransport('not a url', ORIGIN)).toBe(true)
  })
})
