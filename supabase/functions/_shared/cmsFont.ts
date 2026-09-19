import { Buffer } from 'node:buffer'
// @deno-types="npm:@types/fontkit@2.0.9"
import { create } from 'fontkit'

export function inspectWoff2(bytes: Uint8Array): { name: string; glyphs: number } {
  const fail = (): never => {
    throw new Error(
      'Ogiltig WOFF2-fil. Välj ett fullständigt webbtypsnitt med högst 20 000 teckenformer och 16 MiB avkodad data.',
    )
  }
  if (bytes.byteLength < 48 || bytes.byteLength > 5 * 1024 * 1024) return fail()
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    header.getUint32(0) !== 0x774f4632 ||
    header.getUint32(8) !== bytes.byteLength ||
    header.getUint16(14) !== 0 ||
    header.getUint32(4) === 0x74746366
  )
    return fail()
  if (
    header.getUint16(12) < 1 ||
    header.getUint16(12) > 100 ||
    header.getUint32(16) > 16 * 1024 * 1024 ||
    header.getUint32(20) > bytes.byteLength - 48
  )
    return fail()
  try {
    const font = create(Buffer.from(bytes))
    if (
      !('numGlyphs' in font) ||
      !Number.isSafeInteger(font.numGlyphs) ||
      font.numGlyphs < 1 ||
      font.numGlyphs > 20000 ||
      !Number.isFinite(font.unitsPerEm) ||
      font.unitsPerEm < 16 ||
      font.unitsPerEm > 16384
    )
      return fail()
    let outlineBytes = 0
    for (let index = 0; index < font.numGlyphs; index++) {
      const glyph = font.getGlyph(index)
      if (!Number.isFinite(glyph.advanceWidth)) return fail()
      const outline = glyph.path.toSVG()
      outlineBytes += outline.length
      if (outlineBytes > 4 * 1024 * 1024 || /NaN|Infinity/.test(outline)) return fail()
    }
    if (!font.characterSet.length) return fail()
    const name = String(font.familyName || font.fullName || 'Webbtypsnitt')
      .replace(/[<>]/g, '')
      .slice(0, 120)
    return { name, glyphs: font.numGlyphs }
  } catch {
    return fail()
  }
}
