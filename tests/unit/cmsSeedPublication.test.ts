import { describe, expect, it } from 'vitest'
import { emptyDocument, validateCompleteDocument } from '../../shared/cms'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets'
import { ensureCorePages } from '../../src/admin/cms/corePages'

describe('initial canonical page publication', () => {
  it('is a complete valid extension of an authoritative document with no pages', () => {
    const authoritative = emptyDocument()
    const seeded = ensureCorePages(authoritative)
    expect(() => validateCompleteDocument(seeded, authoritative)).not.toThrow()
    expect(() =>
      validateDocumentMarkupPlacements(seeded, {
        siteOrigin: 'https://bladeblendstudio.se',
        storageOrigin: 'https://fixture.supabase.co',
        builtAssets: CMS_BUILT_ASSETS,
      }),
    ).not.toThrow()
  })
})
