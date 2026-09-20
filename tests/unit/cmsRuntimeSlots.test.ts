import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../../shared/cms'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets'

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
  builtAssets: CMS_BUILT_ASSETS,
}

describe('protected runtime islands', () => {
  it.each([
    ['/about', 'knc-about-runtime'],
    ['/booking', 'knc-booking-runtime'],
    ['/my-bookings', 'knc-my-bookings-runtime'],
  ])('rejects removal of %s runtime identity', (path, id) => {
    const document = emptyDocument()
    const variant = { html: `<main><div id="${id}"></div></main>`, css: { light: '', dark: '' } }
    document.presentation.pages.push({
      id: '10000000-0000-4000-8000-000000000001',
      path,
      kind: 'page',
      name: { sv: path, en: path },
      title: { sv: path, en: path },
      description: { sv: '', en: '' },
      inMenu: false,
      content: { sv: structuredClone(variant), en: structuredClone(variant) },
    })
    expect(() => validateDocumentMarkupPlacements(document, policy)).not.toThrow()
    const page = document.presentation.pages.find((item) => item.path === path)
    if (!page) throw new Error('fixture page missing')
    for (const lang of ['sv', 'en'] as const)
      page.content[lang].html = page.content[lang].html.replace(` id="${id}"`, '')
    expect(() => validateDocumentMarkupPlacements(document, policy)).toThrow(
      `Required runtime island #${id} is missing`,
    )
  })
})
