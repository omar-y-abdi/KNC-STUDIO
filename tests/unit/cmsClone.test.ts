import { describe, expect, it } from 'vitest'

describe('CMS clone contract', () => {
  it('documents that clone identities must be remapped before insertion', async () => {
    const source = await import('../../src/admin/cms/clone?raw')
    expect(source.default).toContain('crypto.randomUUID')
    expect(source.default).toContain("'aria-labelledby'")
    expect(source.default).toContain("'aria-describedby'")
    expect(source.default).toContain("value.startsWith('#')")
    expect(source.default).toContain('replaceAll')
  })
})
