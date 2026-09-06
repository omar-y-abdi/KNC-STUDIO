import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('privacy banner placement', () => {
  it('keeps privacy controls below the desktop header without bottom anchoring', () => {
    const source = readFileSync('src/site/PrivacyBanner.tsx', 'utf8')

    expect(source).toContain("const topOffset = 'calc(env(safe-area-inset-top, 0px) + 76px)'")
    expect(source).toContain("right: '12px',\n          top: topOffset")
    expect(source).not.toContain('bottom: bottomOffset')
  })
})
