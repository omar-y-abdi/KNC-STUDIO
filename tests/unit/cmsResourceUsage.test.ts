import { describe, expect, it } from 'vitest'
import { emptyDocument, mediaUrl, type CmsPage, type MediaRef } from '../../shared/cms'
import { resourceUsage } from '../../shared/cms-resources'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup'

const policy = { siteOrigin: 'https://salon.example', storageOrigin: 'https://fixture.supabase.co' }
const image: MediaRef = {
  bucket: 'cms-library',
  path: 'images/22222222-2222-4222-8222-222222222222.webp',
}
const url = mediaUrl(image, policy.storageOrigin)
function fixture(native = true, path = '/') {
  const document = emptyDocument()
  const html = `<main${native ? ' data-knc-native="1"' : ''}><p>${'x'.repeat(130_000)}</p><img src="${url}" alt="Salong" /></main>`
  const page: CmsPage = {
    id: '10000000-0000-4000-8000-000000000001',
    path,
    kind: 'page',
    name: { sv: 'Hem', en: 'Home' },
    title: { sv: '', en: '' },
    description: { sv: '', en: '' },
    inMenu: true,
    content: {
      sv: { html, css: { light: '', dark: '' } },
      en: { html, css: { light: '', dark: '' } },
    },
  }
  document.presentation.pages.push(page)
  return document
}

describe('resource references in the real native site', () => {
  it('accepts the same populated native pages as publication and retains every reference', () => {
    const document = fixture()
    expect(() => validateDocumentMarkupPlacements(structuredClone(document), policy)).not.toThrow()
    const before = structuredClone(document)
    expect(resourceUsage(document, image, policy)).toEqual([
      '/ · sv/light',
      '/ · sv/dark',
      '/ · en/light',
      '/ · en/dark',
    ])
    expect(document).toEqual(before)
  })
  it('does not lend the native allowance to authored pages or shared regions', () => {
    expect(() => resourceUsage(fixture(false), image, policy)).toThrow(
      'Page exceeds its size limit',
    )
    expect(() => resourceUsage(fixture(true, '/offers'), image, policy)).toThrow()
    const document = fixture()
    document.presentation.regions.header = document.presentation.pages[0]!.content
    document.presentation.pages = []
    expect(() => resourceUsage(document, image, policy)).toThrow()
  })
  it('does not hide invalid native HTML or CSS behind an empty usage list', () => {
    const document = fixture()
    document.presentation.pages[0]!.content.sv.html += '<script>alert(1)</script>'
    expect(() => resourceUsage(document, image, policy)).toThrow()
    const oversized = fixture()
    oversized.presentation.pages[0]!.content.sv.html = `<main data-knc-native="1">${'x'.repeat(500_001)}</main>`
    expect(() => resourceUsage(oversized, image, policy)).toThrow('Page exceeds its size limit')
    const css = fixture()
    css.presentation.pages[0]!.content.sv.css.dark = `body{background:url("https://outside.invalid/image.png")}`
    expect(() => resourceUsage(css, image, policy)).toThrow()
  })
})
