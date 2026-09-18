import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inspectWoff2 } from '../../supabase/functions/_shared/cmsFont'

describe('full WOFF2 decoding', () => {
  it.each([
    'InterVariable-Latin.woff2',
    'PlayfairDisplay-Latin-400.woff2',
    'PlayfairDisplay-Latin-700-Italic.woff2',
  ])('decodes every glyph in %s without changing the uploaded bytes', (name) => {
    const bytes = readFileSync(`public/fonts/${name}`),
      before = Buffer.from(bytes)
    const metadata = inspectWoff2(bytes)
    expect(metadata.name.length).toBeGreaterThan(0)
    expect(metadata.glyphs).toBeGreaterThan(10)
    expect(bytes.equals(before)).toBe(true)
  })
  it('rejects truncation, header-only input and intact headers with corrupt compressed data', () => {
    const good = readFileSync('public/fonts/InterVariable-Latin.woff2')
    const corrupt = Buffer.from(good)
    corrupt.fill(0, Math.floor(corrupt.length / 2))
    for (const bytes of [
      new Uint8Array([1, 2, 3]),
      good.subarray(0, 48),
      good.subarray(0, good.length - 1),
      corrupt,
    ])
      expect(() => inspectWoff2(bytes)).toThrow()
  })
  it('bounds decompressed size before decoding', () => {
    const bytes = Buffer.from(readFileSync('public/fonts/InterVariable-Latin.woff2'))
    bytes.writeUInt32BE(0xffffffff, 16)
    expect(() => inspectWoff2(bytes)).toThrow()
  })
})
