import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CMS clone contract', () => {
  it('remaps IDs, fragment links, ARIA references and CSS references before insertion', () => {
    const source = readFileSync('src/admin/cms/clone.ts', 'utf8')
    expect(source).toContain('crypto.randomUUID')
    expect(source).toContain("'aria-labelledby'")
    expect(source).toContain("'aria-describedby'")
    expect(source).toContain("value.startsWith('#')")
    expect(source).toContain('replaceAll')
  })
})
