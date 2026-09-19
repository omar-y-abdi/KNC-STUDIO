import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('desktop top panel', () => {
  it('remains fixed at the viewport top instead of travelling from the hero bottom', () => {
    const source = readFileSync('src/app/DesktopSiteSource.tsx', 'utf8')

    expect(source).toContain("top: '0'")
    expect(source).not.toContain('--desktop-panel-top')
  })
})
