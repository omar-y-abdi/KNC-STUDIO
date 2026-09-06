import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('privacy banner placement', () => {
  it('keeps both privacy controls fixed at the desktop top-right', () => {
    const source = readFileSync('src/site/PrivacyBanner.tsx', 'utf8')

    expect(source).toContain("const topOffset = 'calc(env(safe-area-inset-top, 0px) + 12px)'")
    expect(source).toContain("right: '12px',\n          top: topOffset")
    expect(source).not.toContain('bottom: bottomOffset')
  })
})
