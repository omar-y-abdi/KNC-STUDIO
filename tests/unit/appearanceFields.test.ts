import { describe, expect, it } from 'vitest'
import { emptyDocument, validateDocument } from '../../shared/cms'
import { APPEARANCE_FIELDS } from '../../src/admin/cms/appearanceFields'
import {
  HOMEPAGE_LOGO_SCALE_KEY,
  HOMEPAGE_LOGO_STYLE_KEY,
  HOMEPAGE_SCALE_KEY,
  ABOUT_SCALE_KEY,
} from '../../src/site/siteChrome'

describe('Studio appearance presets', () => {
  it('cover exactly the four presets the removed Startsida tab used to write', () => {
    expect(APPEARANCE_FIELDS.map((field) => field.key).sort()).toEqual(
      [
        HOMEPAGE_LOGO_SCALE_KEY,
        HOMEPAGE_SCALE_KEY,
        HOMEPAGE_LOGO_STYLE_KEY,
        ABOUT_SCALE_KEY,
      ].sort(),
    )
  })

  it.each(APPEARANCE_FIELDS)('$key is a CMS setting and every option publishes', (field) => {
    expect(field.options.map((option) => option.value)).toContain(field.fallback)
    for (const option of field.options) {
      const document = emptyDocument()
      document.settings[field.key] = option.value
      expect(() => validateDocument(document)).not.toThrow()
    }
  })

  it('rejects a value the selects cannot produce', () => {
    const document = emptyDocument()
    document.settings['homepage_logo_style'] = 'sepia'
    expect(() => validateDocument(document)).toThrow()
  })
})
