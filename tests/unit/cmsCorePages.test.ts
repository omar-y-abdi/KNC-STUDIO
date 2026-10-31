import { expect, it } from 'vitest'
import { CORE_PAGE_PATHS, emptyDocument, type CmsPage } from '../../shared/cms'
import {
  ensureCorePages,
  CORE_PAGE_IDS,
  hasCorePageLayouts,
  canOpenStoredPages,
} from '../../src/admin/cms/corePages'

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

it('recognizes stored layouts without requiring newer optional scene markers', () => {
  const document = emptyDocument()
  expect(hasCorePageLayouts(document)).toBe(false)
  expect(canOpenStoredPages(document)).toBe(false)
  document.presentation.pages = CORE_PAGE_PATHS.map((path, index) => ({
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
  const contact = document.presentation.pages.pop()
  expect(hasCorePageLayouts(document)).toBe(false)
  expect(canOpenStoredPages(document)).toBe(true)
  if (!contact) throw new Error('Missing contact source')
  contact.content.sv.html = contact.content.en.html = '<main class="bb-page bb-doc">Kontakt</main>'
  document.presentation.pages.push(contact)
  expect(hasCorePageLayouts(document)).toBe(true)
  expect(canOpenStoredPages(document)).toBe(true)
  contact.content.en.html = ''
  expect(canOpenStoredPages(document)).toBe(false)
  contact.content.en.html = contact.content.sv.html
  const first = document.presentation.pages[0]
  if (!first) throw new Error('Missing stored home page')
  first.content.sv.html = ''
  expect(hasCorePageLayouts(document)).toBe(false)
  expect(canOpenStoredPages(document)).toBe(false)
})

it('adds the contact core identity to retained layouts without replacing an authored contact', async () => {
  const { retainCorePageLayouts } = await import('../../src/admin/cms/corePages')
  const document = emptyDocument()
  const source: CmsPage = {
    id: '10000000-0000-4000-8000-000000000007',
    path: '/contact',
    kind: 'page',
    name: { sv: 'Kontakt', en: 'Contact' },
    title: { sv: 'Kontakt', en: 'Contact' },
    description: { sv: '', en: '' },
    inMenu: false,
    content: {
      sv: { html: '<main class="bb-page bb-doc">Kontakt</main>', css: { light: '', dark: '' } },
      en: { html: '<main class="bb-page bb-doc">Kontakt</main>', css: { light: '', dark: '' } },
    },
  }
  document.presentation.pages = [source]
  retainCorePageLayouts(document)
  try {
    const upgraded = ensureCorePages(emptyDocument())
    expect(upgraded.presentation.pages).toEqual([source])
    expect(ensureCorePages(upgraded)).toEqual(upgraded)
    const existing = structuredClone(document)
    const ownerPage = existing.presentation.pages[0]
    if (!ownerPage) throw new Error('Missing owner contact page')
    ownerPage.content.sv.html = '<main>Owner contact</main>'
    expect(ensureCorePages(existing)).toEqual(existing)
  } finally {
    retainCorePageLayouts(emptyDocument())
  }
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
