import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import {
  CORE_PAGE_PATHS,
  INFORMATION_PAGE_PATHS,
  emptyDocument,
  isCreatedPagePath,
  isPagePath,
  validateCompleteDocument,
  validatePresentation,
  type CmsPage,
} from '../../shared/cms'
import { isSitePage } from '../../shared/site-page'
import { validateDocumentMarkupPlacements, validateMarkup } from '../../shared/cms-markup'
import { legalCanvasBase } from '../../src/admin/cms/nativeCanvas'

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
}

it.each(['privacy', 'terms'])('accepts the CSS the importer stores for %s', (page) => {
  const html = readFileSync(new URL(`../../public/${page}.html`, import.meta.url), 'utf8')
  // Only the page's own <style> is stored; the Worker inlines the linked base sheets (STY-7).
  const links = [...html.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1])
  expect(links).toEqual(['/tokens.css', '/info.css'])
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
  expect(() => validateMarkup('', css, policy)).not.toThrow()
})

it('keeps contact on the public information base in the canvas, outside authored page chrome', () => {
  const page = contactDocument().presentation.pages[0]
  if (!page) throw new Error('Missing contact page')
  expect(isSitePage(page)).toBe(false)
  for (const mode of ['light', 'dark'] as const)
    expect(legalCanvasBase('/contact', mode)).toEqual({
      styles: ['/tokens.css', '/info.css'],
      scheme: mode,
    })
  page.layout = 'independent'
  // An existing authored contact can already carry this metadata; keep its document readable.
  expect(() => validatePresentation(contactDocument(page).presentation)).not.toThrow()
})

it('shares the core and information paths while reserving contact only from new page creation', () => {
  expect(INFORMATION_PAGE_PATHS).toEqual(['/privacy', '/terms', '/contact'])
  expect(CORE_PAGE_PATHS).toEqual([
    '/',
    '/about',
    '/booking',
    '/my-bookings',
    ...INFORMATION_PAGE_PATHS,
  ])
  for (const path of CORE_PAGE_PATHS) expect(isCreatedPagePath(path)).toBe(false)
  expect(isCreatedPagePath('/owner-page')).toBe(true)
  expect(isCreatedPagePath('/owner-page/summer')).toBe(true)
  expect(isCreatedPagePath('/assets/file')).toBe(false)
  expect(isPagePath('/contact')).toBe(true)
})

it('validates the contact page with the client schema and both cms-studio Edge validators', () => {
  for (const independent of [false, true]) {
    const document = contactDocument()
    const page = document.presentation.pages[0]
    if (!page) throw new Error('Missing contact page')
    if (independent) page.layout = 'independent'
    expect(() => validatePresentation(document.presentation)).not.toThrow()
    expect(() => validateCompleteDocument(document, emptyDocument())).not.toThrow()
    expect(() => validateDocumentMarkupPlacements(document, policy)).not.toThrow()
  }
})

it.each([
  '<main>Owner contact</main>',
  '<main><span data-business-name="">Ägarens företagsnamn</span></main>',
  '<main><div id="contact-details">Ägarens kontaktuppgifter</div></main>',
])('keeps an unmarked legacy contact publishable without rewriting its body: %s', (html) => {
  const document = contactDocument()
  const page = document.presentation.pages[0]
  if (!page) throw new Error('Missing contact page')
  page.layout = 'independent'
  for (const lang of ['sv', 'en'] as const) page.content[lang].html = html
  expect(() => validateCompleteDocument(document, document)).not.toThrow()
  expect(() => validateDocumentMarkupPlacements(document, policy)).not.toThrow()
  for (const lang of ['sv', 'en'] as const) expect(page.content[lang].html).toBe(html)
})

it('still applies the markup security boundary to an unmarked legacy contact', () => {
  const document = contactDocument()
  const page = document.presentation.pages[0]
  if (!page) throw new Error('Missing contact page')
  page.content.sv.html = '<main><p onclick="alert(1)">Owner contact</p></main>'
  expect(() => validateDocumentMarkupPlacements(document, policy)).toThrow(
    'Unsupported attribute onclick',
  )
})

function contactDocument(page?: CmsPage) {
  const document = emptyDocument()
  const source = readFileSync(new URL('../../public/contact.html', import.meta.url), 'utf8')
  const html = source.slice(source.indexOf('<body>') + '<body>'.length, source.indexOf('</body>'))
  const variant = { html, css: { light: '', dark: '' } }
  document.presentation.pages = [
    page ?? {
      id: '10000000-0000-4000-8000-000000000007',
      path: '/contact',
      kind: 'page',
      inMenu: false,
      name: { sv: 'Kontakt', en: 'Contact' },
      title: { sv: 'Kontakt', en: 'Contact' },
      description: { sv: '', en: '' },
      content: { sv: structuredClone(variant), en: structuredClone(variant) },
    },
  ]
  return document
}

it('accepts the imported contact body and rejects deletion of its live business slots', () => {
  const document = contactDocument()
  expect(() => validateDocumentMarkupPlacements(document, policy)).not.toThrow()
  expect(document.presentation.pages[0]?.content.sv.html).toContain(
    'data-business-contact-page="1"',
  )
  // Each pattern removes the whole attribute, whether serialized bare or with an empty value.
  for (const [attribute, slot] of [
    [/ id="contact-details"/g, '#contact-details'],
    [/ id="contact-hours"/g, '#contact-hours'],
    [/ data-business-name(?:="")?/g, '[data-business-name]'],
    [/ data-business-city(?:="")?/g, '[data-business-city]'],
  ] as const) {
    const broken = structuredClone(document)
    const page = broken.presentation.pages[0]
    if (!page) throw new Error('Missing contact page')
    page.content.sv.html = page.content.sv.html.replace(attribute, '')
    expect(() => validateMarkup(page.content.sv.html, '', policy)).not.toThrow()
    expect(() => validateDocumentMarkupPlacements(broken, policy)).toThrow(
      `Contact page is missing required server-owned slot(s): ${slot}`,
    )
  }
  const empty = structuredClone(document)
  const page = empty.presentation.pages[0]
  if (!page) throw new Error('Missing contact page')
  page.content.sv.html = '<main data-business-contact-page="1">Ägarens kontakttext</main>'
  expect(() => validateDocumentMarkupPlacements(empty, policy)).toThrow(
    'Contact page is missing required server-owned slot(s): #contact-details, #contact-hours, [data-business-name], [data-business-city]',
  )
})

it('parses safe custom properties and nested variable fallbacks', () => {
  const css = ':root{--surface:#fff;--space:12px}main{color:var(--fg,var(--fallback,#222))}'
  expect(() => validateMarkup('<main>Original site</main>', css, policy)).not.toThrow()
})

it.each([
  ':root{--image:url(https://attacker.invalid/track)}',
  'main{background:var(--image,url(https://attacker.invalid/track))}',
  ':root{--image:image-set(url(https://attacker.invalid/track) 1x)}',
  ':root{--value:expression(alert(1))}',
  ':root{--value:attr(data-secret)}',
  ':root{--cms-internal-state:1}',
  '@import "https://attacker.invalid/style.css";',
])('still rejects unsafe CSS inside variables: %s', (css) => {
  expect(() => validateMarkup('', css, policy)).toThrow()
})
