import { describe, expect, it } from 'vitest'
import { emptyDocument, mediaUrl, validateDocument, type CmsAsset, type CmsPage } from '../../shared/cms'
import { replaceDocumentResource, resourceUsage } from '../../shared/cms-resources'

const policy = { siteOrigin: 'https://salon.example', storageOrigin: 'https://fixture.supabase.co' }
const previous: CmsAsset = {
  id: '20000000-0000-4000-8000-000000000001', bucket: 'cms-library', path: 'images/old.webp',
  name: 'Old', mime: 'image/webp', alt: '', bytes: 100, width: 10, height: 10, archived: false, version: 1,
}
const next: CmsAsset = { ...previous, id: '20000000-0000-4000-8000-000000000002', path: 'images/new.webp', name: 'New' }
const oldUrl = mediaUrl(previous, policy.storageOrigin)
const newUrl = mediaUrl(next, policy.storageOrigin)

describe('resource replacement uses the complete native wire contract', () => {
  it('does not embed inventory-only fields in media references', () => {
    const document = emptyDocument()
    document.presentation.images.hero = { ref: { bucket: previous.bucket, path: previous.path }, alt: { sv: '', en: '' } }
    replaceDocumentResource(document, previous, next, policy)
    expect(() => validateDocument(document)).not.toThrow()
    expect(document.presentation.images.hero.ref).toEqual({ bucket: next.bucket, path: next.path })
  })

  it('replaces native styles and metadata but not literal owner text', () => {
    const document = emptyDocument()
    const metadata = JSON.stringify({ src: oldUrl, text: oldUrl }).replaceAll('"', '&quot;')
    const html = `<main data-knc-native="1"><img id="hero" src="${oldUrl}" data-knc-light="background-image:url('${oldUrl}')" data-knc-dark="background-image:url('${oldUrl}')" data-knc-baseline="${metadata}" data-knc-dark-attrs="${metadata}" alt="${oldUrl}"><p>${oldUrl}</p></main>`
    const page: CmsPage = {
      id: '10000000-0000-4000-8000-000000000001', path: '/', kind: 'page',
      name: { sv: 'Hem', en: 'Home' }, title: { sv: '', en: '' }, description: { sv: '', en: '' }, inMenu: true,
      content: {
        sv: { html, css: { light: `#hero{--image:url('${oldUrl}');background:var(--image)}`, dark: '' } },
        en: { html, css: { light: '', dark: '' } },
      },
    }
    document.presentation.pages.push(page)
    replaceDocumentResource(document, previous, next, policy)
    expect(resourceUsage(document, previous, policy)).toEqual([])
    expect(resourceUsage(document, next, policy)).toHaveLength(4)
    expect(page.content.sv.html).toContain(`<p>${oldUrl}</p>`)
    expect(page.content.sv.html).toContain(`alt="${oldUrl}"`)
    expect(page.content.sv.css.light).toContain(newUrl)
    expect(page.content.sv.css.light).not.toContain(oldUrl)
  })
})
