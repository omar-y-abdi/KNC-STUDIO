import { describe, expect, it } from 'vitest'
import { emptyDocument, type CmsAsset } from '../../shared/cms'
import {
  siteResources,
  editSiteResource,
  replaceSiteResource,
} from '../../shared/cms-site-resources'

const asset: CmsAsset = {
  id: '28000000-0000-4000-8000-000000000001',
  bucket: 'cms-library',
  path: 'images/replacement.webp',
  name: 'Replacement',
  alt: 'New mark',
  mime: 'image/webp',
  width: 100,
  height: 100,
  bytes: 100,
  archived: false,
  version: 1,
}
const origin = 'https://fixture.supabase.co'
function fixture(
  html = '<svg id="mark" data-knc-source="native-mark" role="img"><text>BNB</text></svg>',
) {
  const document = emptyDocument()
  const variant = () => ({
    html: `<div data-knc-native="1">${html}</div>`,
    css: { light: '', dark: '' },
  })
  document.presentation.pages = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      kind: 'page',
      path: '/',
      name: { sv: 'Startsida', en: 'Home' },
      title: { sv: '', en: '' },
      description: { sv: '', en: '' },
      inMenu: true,
      content: { sv: variant(), en: variant() },
    },
  ]
  return document
}
const target = { pageId: '10000000-0000-4000-8000-000000000001', id: 'mark', source: 'native-mark' }
describe('website resource mutation boundary', () => {
  it('edits only the selected locale and preserves native metadata', () => {
    const document = fixture(),
      before = structuredClone(document)
    const next = editSiteResource(document, target, 'sv', 'Logotyp', ['<Owner>'])
    expect(next.presentation.pages[0]?.content.sv.html).toContain('&lt;Owner&gt;')
    expect(next.presentation.pages[0]?.content.en).toEqual(before.presentation.pages[0]?.content.en)
    expect(next.presentation.pages[0]?.content.sv.html).toContain('data-knc-source="native-mark"')
    expect(document).toEqual(before)
  })
  it('matches corresponding native graphics by identity when locale IDs differ', () => {
    const document = fixture()
    const content = document.presentation.pages[0]?.content
    if (!content) throw new Error('Missing fixture page')
    content.en.html = content.en.html.replace('id="mark"', 'id="english-mark"')
    const next = replaceSiteResource(document, target, asset, origin)
    for (const lang of ['sv', 'en'] as const)
      expect(next.presentation.pages[0]?.content[lang].html).toContain(
        '/cms-library/images/replacement.webp',
      )
    expect(next.presentation.pages[0]?.content.en.html).toContain('id="english-mark"')
  })
  it.each(['data-knc-required="true"', 'data-knc-slot="child"'])(
    'does not erase functional descendants (%s)',
    (marker) => {
      const document = fixture(
        `<svg id="mark" data-knc-source="native-mark"><g ${marker}><path /></g></svg>`,
      )
      expect(siteResources(document, 'sv')[0]?.replaceable).toBe(false)
      expect(() => replaceSiteResource(document, target, asset, origin)).toThrow()
    },
  )
  it('rejects ambiguous duplicated targets without mutating the draft', () => {
    const document = fixture(
      '<svg id="mark" data-knc-source="native-mark"></svg><img id="mark" data-knc-source="native-mark" src="/og-image.png">',
    )
    expect(() => replaceSiteResource(document, target, asset, origin)).toThrow()
  })
  it('rejects invalid media references and unavailable assets before editing', () => {
    for (const invalid of [
      { ...asset, archived: true },
      { ...asset, trashed_at: '2026-09-25' },
      { ...asset, path: '../bad.webp' },
    ])
      expect(() => replaceSiteResource(fixture(), target, invalid, origin)).toThrow()
  })
  it('keeps a renamed functional control discoverable using its native baseline', () => {
    const document = fixture(
      `<button id="language" data-knc-source="native-language" data-knc-required="true" aria-label="Choose" data-knc-baseline='{ "aria-label": "Byt språk till engelska" }'><span>SV</span><span>EN</span></button>`,
    )
    expect(siteResources(document, 'sv').map((item) => item.id)).toContain('language')
  })
  it('does not promise a two-language replacement when the counterpart is absent', () => {
    const document = fixture()
    const content = document.presentation.pages[0]?.content
    if (!content) throw new Error('Missing fixture page')
    content.en.html = '<p>No corresponding graphic</p>'
    expect(() => replaceSiteResource(document, target, asset, origin)).toThrow()
    expect(document.presentation.pages[0]?.content.sv.html).toContain('<svg')
  })
})
