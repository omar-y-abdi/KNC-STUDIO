import { expect, it } from 'vitest'
import { emptyDocument, type CmsPage } from '../../shared/cms'
import { ensureCorePages, CORE_PAGE_IDS } from '../../src/admin/cms/corePages'

it('requires a rendered source instead of supplying another website', () => {
  expect(ensureCorePages(emptyDocument())).toEqual(emptyDocument())
})

it('imports only supplied source pages, preserves existing edits and does not duplicate routes', () => {
  const page: CmsPage = {
    id: CORE_PAGE_IDS[0],
    path: '/',
    kind: 'page',
    name: { sv: 'Startsida', en: 'Home' },
    title: { sv: 'KNC', en: 'KNC' },
    description: { sv: '', en: '' },
    inMenu: true,
    content: {
      sv: { html: '<main>Actual source</main>', css: { light: '', dark: '' } },
      en: { html: '<main>Actual source</main>', css: { light: '', dark: '' } },
    },
  }
  const document = emptyDocument()
  const result = ensureCorePages(document, [page])
  expect(document.presentation.pages).toEqual([])
  expect(result.presentation.pages).toEqual([page])
  const first = result.presentation.pages[0]
  if (!first) throw new Error('Missing supplied source page')
  first.content.sv.html = '<main>Owner edit</main>'
  expect(ensureCorePages(result, [page])).toEqual(result)
})

it('recognizes stored layouts without requiring newer optional scene markers', async () => {
  const { hasCorePageLayouts } = await import('../../src/admin/cms/corePages')
  const document = emptyDocument()
  expect(hasCorePageLayouts(document)).toBe(false)
  const paths = ['/', '/about', '/booking', '/my-bookings', '/privacy', '/terms']
  document.presentation.pages = paths.map((path, index) => ({
    id: CORE_PAGE_IDS[index] ?? CORE_PAGE_IDS[0],
    path,
    kind: 'page',
    inMenu: false,
    name: { sv: path, en: path },
    title: { sv: '', en: '' },
    description: { sv: '', en: '' },
    content: {
      sv: { html: '<main data-knc-native="1">Owner copy</main>', css: { light: '', dark: '' } },
      en: { html: '<main data-knc-native="1">Owner copy</main>', css: { light: '', dark: '' } },
    },
  }))
  expect(hasCorePageLayouts(document)).toBe(true)
  const first = document.presentation.pages[0]
  if (!first) throw new Error('Missing stored home page')
  first.content.sv.html = ''
  expect(hasCorePageLayouts(document)).toBe(false)
})

it('retains authoritative core layouts for legacy restore without copying unrelated pages', async () => {
  const { retainCorePageLayouts } = await import('../../src/admin/cms/corePages')
  const document = emptyDocument()
  const page: CmsPage = {
    id: CORE_PAGE_IDS[0],
    path: '/',
    kind: 'page',
    inMenu: true,
    name: { sv: 'Home', en: 'Home' },
    title: { sv: '', en: '' },
    description: { sv: '', en: '' },
    content: {
      sv: { html: '<main data-knc-native="1">Stored layout</main>', css: { light: '', dark: '' } },
      en: { html: '<main data-knc-native="1">Stored layout</main>', css: { light: '', dark: '' } },
    },
  }
  document.presentation.pages = [page, { ...page, id: 'custom-page', path: '/custom' }]
  retainCorePageLayouts(document)
  try {
    const legacy = emptyDocument()
    legacy.settings.business_name = 'Unsaved owner name'
    const restored = ensureCorePages(legacy)
    expect(restored.presentation.pages).toEqual([page])
    expect(restored.settings.business_name).toBe('Unsaved owner name')
    expect(legacy.presentation.pages).toEqual([])
  } finally {
    retainCorePageLayouts(emptyDocument())
  }
})
