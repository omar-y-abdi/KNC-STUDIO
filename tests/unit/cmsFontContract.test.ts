import { describe, expect, it } from 'vitest'
import { emptyDocument, validateDocument, documentMedia } from '../../shared/cms'

const id = '10000000-0000-4000-8000-000000000001'
describe('uploaded font publication contract', () => {
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
