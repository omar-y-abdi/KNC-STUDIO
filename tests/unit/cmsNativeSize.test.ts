import { expect, it } from 'vitest'
import { emptyDocument, validateDocument, type CmsPage } from '../../shared/cms'
import { resourceUsage } from '../../shared/cms-resources'
import { validateMarkup } from '../../shared/cms-markup'

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
}
const nativeHtml = (length: number) => `<main data-knc-native="1">${'x'.repeat(length)}</main>`
function documentWith(html: string) {
  const document = emptyDocument()
  const page: CmsPage = {
    id: '10000000-0000-4000-8000-000000000001',
    path: '/',
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

it('accepts populated native captures above the ordinary page limit in both publish validators', () => {
  const html = nativeHtml(160_000)
  expect(() => validateDocument(documentWith(html))).not.toThrow()
  expect(validateMarkup(html, '', policy, { native: true }).html).toBe(html)
})

it('keeps native HTML bounded and retains the ordinary HTML and CSS limits', () => {
  const oversized = nativeHtml(500_000)
  expect(() => validateDocument(documentWith(oversized))).toThrow()
  expect(() => validateMarkup(oversized, '', policy, { native: true })).toThrow()
  const ordinary = `<main>${'x'.repeat(100_000)}</main>`
  expect(() => validateDocument(documentWith(ordinary))).toThrow()
  expect(() => validateMarkup(ordinary, '', policy)).toThrow()
  expect(() =>
    validateMarkup(nativeHtml(1), ' '.repeat(100_001), policy, { native: true }),
  ).toThrow()
})

it('still rejects a native document exceeding the combined 2 MiB limit', () => {
  const document = documentWith(nativeHtml(450_000))
  const page = document.presentation.pages[0]
  if (!page) throw new Error('Missing fixture page')
  document.presentation.pages.push(
    {
      ...page,
      id: '20000000-0000-4000-8000-000000000001',
      path: '/about',
    },
    {
      ...page,
      id: '30000000-0000-4000-8000-000000000001',
      path: '/booking',
    },
  )
  expect(() => validateDocument(document)).toThrow('Maximum document size is 2 MiB')
})

// Resource details must accept the same native capture that can be published.
it('finds resources in large native captures without mutating the draft', () => {
  const reference = { bucket: 'gallery', path: 'logo/studio.webp' }
  const html = `<main data-knc-native="1">${'x'.repeat(160_000)}<img src="${policy.storageOrigin}/storage/v1/object/public/gallery/logo/studio.webp" alt="Studio"></main>`
  const document = documentWith(html)
  const before = structuredClone(document)
  expect(resourceUsage(document, reference, policy)).toEqual([
    '/ · sv/light',
    '/ · sv/dark',
    '/ · en/light',
    '/ · en/dark',
  ])
  expect(document).toEqual(before)
})

it('does not grant native resource-inspection limits to authored pages or shared regions', () => {
  const reference = { bucket: 'gallery', path: 'logo/studio.webp' }
  const document = documentWith(nativeHtml(160_000))
  const page = document.presentation.pages[0]!
  page.path = '/custom'
  expect(() => resourceUsage(document, reference, policy)).toThrow('Page exceeds its size limit')
  document.presentation.pages = []
  document.presentation.regions.header = page.content
  expect(() => resourceUsage(document, reference, policy)).toThrow('Page exceeds its size limit')
})
