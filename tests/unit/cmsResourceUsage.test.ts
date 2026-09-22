import { expect, it } from 'vitest'
import { emptyDocument, type CmsPage } from '../../shared/cms'
import { resourceUsage } from '../../shared/cms-resources'

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
}
const asset = { bucket: 'cms-library' as const, path: 'images/example.webp' }
const src = `${policy.storageOrigin}/storage/v1/object/public/${asset.bucket}/${asset.path}`
function fixture(path = '/', native = true, size = 160_000) {
  const document = emptyDocument()
  const html = `<main${native ? ' data-knc-native="1"' : ''}><img src="${src}" alt="Salongen"><p>${'x'.repeat(size)}</p></main>`
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

it('inspects resources on the full native site without applying the smaller custom-page limit', () => {
  const document = fixture()
  const before = structuredClone(document)
  expect(resourceUsage(document, asset, policy)).toEqual([
    '/ · sv/light',
    '/ · sv/dark',
    '/ · en/light',
    '/ · en/dark',
  ])
  expect(document).toEqual(before)
})

it('does not grant native limits to custom pages or ordinary markup', () => {
  expect(() => resourceUsage(fixture('/custom'), asset, policy)).toThrow('size limit')
  expect(() => resourceUsage(fixture('/', false), asset, policy)).toThrow('size limit')
  expect(() => resourceUsage(fixture('/', true, 500_000), asset, policy)).toThrow('size limit')
})

it('still rejects unsafe native markup instead of making resource inspection a validation bypass', () => {
  const document = fixture('/', true, 1)
  const page = document.presentation.pages[0]
  if (!page) throw new Error('Missing fixture page')
  page.content.sv.html = '<main data-knc-native="1"><img src="javascript:alert(1)"></main>'
  expect(() => resourceUsage(document, asset, policy)).toThrow()
})
