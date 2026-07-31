import { describe, expect, it, vi } from 'vitest'
import { createFetch } from '../fetch'

// The real module reaches for window.__TAURI_INTERNALS__, which does not exist
// under jsdom. The factory takes both transports as arguments, so the mock only
// has to satisfy the import.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

// The parameters are declared, even though unused, because a zero-argument
// mock implementation types `Mock['calls']` as `[][]`, which breaks the
// `calls[0]?.[0]` assertion below at compile time. Underscore-prefixed
// parameters are exempt from `noUnusedParameters`.
function transports() {
  const webview = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('webview'),
  )
  const native = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('native'),
  )
  return { webview, native, patched: createFetch(webview, native) }
}

describe('createFetch', () => {
  it('sends same-origin requests to the webview transport', async () => {
    const { webview, native, patched } = transports()

    await patched('/api/control/info')

    expect(webview).toHaveBeenCalledTimes(1)
    expect(native).not.toHaveBeenCalled()
  })

  it('sends cross-origin requests to the native transport', async () => {
    const { webview, native, patched } = transports()

    await patched('http://192.168.1.5:9090/version')

    expect(native).toHaveBeenCalledTimes(1)
    expect(webview).not.toHaveBeenCalled()
  })

  it('routes a Request instance by its url', async () => {
    const { webview, native, patched } = transports()
    const request = new Request('http://192.168.1.5:9090/proxies')

    await patched(request)

    expect(native).toHaveBeenCalledTimes(1)
    expect(native.mock.calls[0]?.[0]).toBe(request)
    expect(webview).not.toHaveBeenCalled()
  })

  it('forwards input and init untouched', async () => {
    const { native, patched } = transports()
    const init = { method: 'PUT', headers: { authorization: 'Bearer s3cret' } }

    await patched('https://api.github.com/repos/a/b', init)

    expect(native).toHaveBeenCalledWith(
      'https://api.github.com/repos/a/b',
      init,
    )
  })

  it('returns whatever the chosen transport returns', async () => {
    const { patched } = transports()

    const response = await patched('http://192.168.1.5:9090/version')

    expect(await response.text()).toBe('native')
  })
})
