import { describe, expect, it } from 'vitest'
import { cmsFontFaceCss, emptyDocument, validateDocument, documentMedia } from '../../shared/cms'

const id = '10000000-0000-4000-8000-000000000001'
describe('uploaded font publication contract', () => {
  it('emits the exact legacy font-face bytes in registry order', () => {
    const fonts = {
      [id]: { ref: { bucket: 'cms-library' as const, path: 'fonts/first.woff2' }, name: 'First' },
      '20000000-0000-4000-8000-000000000002': {
        ref: { bucket: 'cms-library' as const, path: 'fonts/second-font.woff2' },
        name: 'Second',
      },
    }
    const expected =
      '@font-face{font-family:"CMSFont-10000000-0000-4000-8000-000000000001";src:url("https://fixture.invalid/storage/v1/object/public/cms-library/fonts/first.woff2") format("woff2");font-display:swap}\n' +
      '@font-face{font-family:"CMSFont-20000000-0000-4000-8000-000000000002";src:url("https://fixture.invalid/storage/v1/object/public/cms-library/fonts/second-font.woff2") format("woff2");font-display:swap}'
    expect(cmsFontFaceCss(fonts, 'https://fixture.invalid/')).toBe(expected)
    expect(cmsFontFaceCss(fonts, 'https://fixture.invalid')).toBe(expected)
    expect(cmsFontFaceCss({}, '')).toBe('')
    expect(cmsFontFaceCss(undefined, '')).toBe('')
  })
  it('accepts a registered font definition and retains it as a publication resource', () => {
    const document = emptyDocument()
    Object.assign(document.presentation, {
      fonts: {
        [id]: { ref: { bucket: 'cms-library', path: 'fonts/font.woff2' }, name: 'My font' },
      },
    })
    document.presentation.themes.light['fontFamily'] = `CMSFont-${id}`
    validateDocument(document)
    expect(documentMedia(document)).toContainEqual({
      bucket: 'cms-library',
      path: 'fonts/font.woff2',
    })
  })
  it('rejects a font family with no registered definition', () => {
    const document = emptyDocument()
    document.presentation.themes.dark['fontFamily'] = `CMSFont-${id}`
    expect(() => validateDocument(document)).toThrow()
  })
  it('rejects non-font resources and unsupported buckets in font definitions', () => {
    for (const ref of [
      { bucket: 'gallery', path: 'font.woff2' },
      { bucket: 'cms-library', path: 'photo.webp' },
      { bucket: 'cms-library', path: '../font.woff2' },
    ]) {
      const document = emptyDocument()
      Object.assign(document.presentation, { fonts: { [id]: { ref, name: 'Unsafe' } } })
      expect(() => validateDocument(document)).toThrow()
    }
  })
})
