import { describe, expect, it } from 'vitest'
import { installSafeAreaPadding } from '../safe-area'

describe('installSafeAreaPadding', () => {
  it('injects a style with the safe-area padding rule', () => {
    installSafeAreaPadding(document)
    const style = document.documentElement.lastElementChild
    expect(style?.tagName).toBe('STYLE')
    expect(style?.textContent).toContain('env(safe-area-inset-top,0px)')
    expect(style?.textContent).toContain('env(safe-area-inset-bottom,0px)')
  })
})
