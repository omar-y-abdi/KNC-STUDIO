import { describe, expect, it } from 'vitest'
import { emptyDocument, validateCompleteDocument } from '../../packages/content-contracts/src/cms'
import { validateDocumentMarkupPlacements } from '../../packages/content-contracts/src/cms-markup'
import { CMS_BUILT_ASSETS } from '../../packages/content-contracts/src/cms-built-assets'
import { ensureCorePages } from '../../modules/studio/src/corePages'

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
