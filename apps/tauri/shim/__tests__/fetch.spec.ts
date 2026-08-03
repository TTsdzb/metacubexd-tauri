import { beforeEach, describe, expect, it, vi } from 'vitest'

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: connectMock,
}))

import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { createFetch } from '../fetch'

const mockedPluginFetch = vi.mocked(pluginFetch)
const ORIGIN = 'http://tauri.localhost'

function makeFetch() {
  const nativeFetch = vi.fn(async () => new Response('native', { status: 200 }))
  return {
    nativeFetch,
    shimFetch: createFetch(nativeFetch as typeof fetch, ORIGIN),
  }
}

describe('createFetch', () => {
  beforeEach(() => {
    mockedPluginFetch.mockReset()
    mockedPluginFetch.mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  it('dispatches cross-origin requests to the plugin with the same arguments', async () => {
    const { nativeFetch, shimFetch } = makeFetch()
    const init = { method: 'GET', headers: { Authorization: 'Bearer s3cret' } }
    const res = await shimFetch('http://192.168.1.5:9090/version', init)
    expect(mockedPluginFetch).toHaveBeenCalledWith(
      'http://192.168.1.5:9090/version',
      init,
    )
    expect(await res.json()).toEqual({ ok: true })
    expect(nativeFetch).not.toHaveBeenCalled()
  })

  it('dispatches same-origin requests to the captured native fetch', async () => {
    const { nativeFetch, shimFetch } = makeFetch()
    await shimFetch('/config.js')
    expect(nativeFetch).toHaveBeenCalledWith('/config.js', undefined)
    expect(mockedPluginFetch).not.toHaveBeenCalled()
  })

  it('passes the abort signal through to the plugin', async () => {
    const { nativeFetch, shimFetch } = makeFetch()
    const controller = new AbortController()
    await shimFetch('https://api.github.com/x', { signal: controller.signal })
    expect(mockedPluginFetch).toHaveBeenCalledWith('https://api.github.com/x', {
      signal: controller.signal,
    })
    expect(nativeFetch).not.toHaveBeenCalled()
  })
})
