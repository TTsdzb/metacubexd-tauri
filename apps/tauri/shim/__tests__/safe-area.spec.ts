import { describe, expect, it } from 'vitest'
import { installSafeAreaPadding } from '../safe-area'

describe('installSafeAreaPadding', () => {
  it('injects a style with the safe-area padding rules', () => {
    installSafeAreaPadding(document)
    const style = document.documentElement.lastElementChild
    expect(style?.tagName).toBe('STYLE')
    expect(style?.textContent).toContain('env(safe-area-inset-top,0px)')
    expect(style?.textContent).toContain('env(safe-area-inset-bottom,0px)')
    // The fixed bottom nav (Tailwind: `fixed inset-x-0 bottom-0`) must clear
    // the navigation bar too — body padding does not move fixed elements.
    expect(style?.textContent).toContain('[class~="fixed"][class~="bottom-0"]')
  })
})
