import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CORE_PAGE_PATHS,
  emptyDocument,
  validateDocument,
  type CmsDocument,
  type CmsPage,
} from '../../packages/content-contracts/src/cms'
import { CMS_BUILT_ASSETS } from '../../packages/content-contracts/src/cms-built-assets'
import { validateDocumentMarkupPlacements } from '../../packages/content-contracts/src/cms-markup'
import { createSitePage } from '../../packages/content-contracts/src/site-page'
import {
  ensureCorePages,
  CORE_PAGE_IDS,
  hasCorePageLayouts,
  canOpenStoredPages,
  retainCorePageLayouts,
} from '../../modules/studio/src/corePages'
import { restoreRevision } from '../../modules/studio/src/draft'

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
  // An empty Contact variant is optional source work (G08): the stored pages still open.
  contact.content.en.html = ''
  expect(hasCorePageLayouts(document)).toBe(false)
  expect(canOpenStoredPages(document)).toBe(true)
  contact.content.en.html = contact.content.sv.html
  const first = document.presentation.pages[0]
  if (!first) throw new Error('Missing stored home page')
  first.content.sv.html = ''
  expect(hasCorePageLayouts(document)).toBe(false)
  expect(canOpenStoredPages(document)).toBe(false)
})

it('adds the contact core identity to retained layouts without replacing an authored contact', async () => {
  const { retainCorePageLayouts } = await import('../../modules/studio/src/corePages')
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
  const { retainCorePageLayouts } = await import('../../modules/studio/src/corePages')
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

// Production revision 56: six core pages captured before Contact became one.
const revision56 = (): CmsDocument => ({
  ...emptyDocument(),
  presentation: JSON.parse(
    gunzipSync(
      readFileSync(new URL('../../tools/e2e/fixtures/presentation.json.gz', import.meta.url)),
    ).toString('utf8'),
  ).presentation,
})
const publicationPolicy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://admin-harness.invalid',
  builtAssets: CMS_BUILT_ASSETS,
}
/** The app's own publication validators accept the document. */
function accepted(document: CmsDocument): void {
  validateDocument(document)
  validateDocumentMarkupPlacements(document, publicationPolicy)
}
const DOCUMENT_BYTES = 2 * 1024 * 1024
const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length
// A Contact page the base Studio created at /contact under a random identity.
const HISTORICAL_CONTACT_ID = '20000000-0000-4000-8000-000000000099'
const OWNER_CONTACT = {
  sv: '<main id="kontakt"><h1>Kontakta oss</h1><p>Ring salongen.</p></main>',
  en: '<main id="contact"><h1>Contact us</h1><p>Call the salon.</p></main>',
}
function contactPage(id: string, html: { sv: string; en: string }): CmsPage {
  return {
    id,
    path: '/contact',
    kind: 'page',
    inMenu: false,
    name: { sv: 'Kontakt', en: 'Contact' },
    title: { sv: '', en: '' },
    description: { sv: '', en: '' },
    content: {
      sv: { html: html.sv, css: { light: '#kontakt{padding:8px}', dark: '#kontakt{padding:8px}' } },
      en: { html: html.en, css: { light: '#contact{padding:8px}', dark: '#contact{padding:8px}' } },
    },
  }
}
// The Contact page a source capture adds, under its reserved identity.
const CONTACT_SOURCE = contactPage(CORE_PAGE_IDS[6], {
  sv: '<main class="bb-page bb-doc"><h1>Kontakt</h1></main>',
  en: '<main class="bb-page bb-doc"><h1>Contact</h1></main>',
})
const sourcePages = (): CmsPage[] => [...revision56().presentation.pages, CONTACT_SOURCE]
const createdPage = (
  index: number,
  id = `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
) =>
  createSitePage({ id, path: `/sida-${index}`, name: { sv: `Sida ${index}`, en: `Page ${index}` } })
/** Revision 56 plus created pages up to `count` pages; `reserved` puts the reserved Contact
 * identity on the first created page. */
function withCreatedPages(count: number, reserved = false): CmsDocument {
  const document = revision56()
  for (let index = 1; document.presentation.pages.length < count; index++)
    document.presentation.pages.push(
      createdPage(index, reserved && index === 1 ? CORE_PAGE_IDS[6] : undefined),
    )
  return document
}
/** Revision 56 plus created pages filling the document to `slack` bytes below its budget. */
function withinBytes(slack: number, document = revision56()): CmsDocument {
  const fill = (page: CmsPage, sv: number, en: number): void => {
    for (const [lang, size] of [
      ['sv', sv],
      ['en', en],
    ] as const)
      page.content[lang].html =
        `<main id="cms-body-${page.id}-${lang}"><p>${'x'.repeat(size)}</p></main>`
  }
  for (let index = 1; bytes(document) < DOCUMENT_BYTES - slack; index++) {
    const page = createdPage(index)
    fill(page, 0, 0)
    document.presentation.pages.push(page)
    const room = DOCUMENT_BYTES - slack - bytes(document)
    // Keep room for another empty page whenever this one cannot take the whole remainder.
    const size = room <= 180_000 ? room : Math.min(180_000, room - 2_000)
    fill(page, Math.ceil(size / 2), Math.floor(size / 2))
  }
  return document
}

describe('mandatory Contact upgrade within the document budget (G06)', () => {
  const ids = (document: CmsDocument): string[] => document.presentation.pages.map(({ id }) => id)
  const expectOwnerPagesKept = (original: CmsDocument, adopted: CmsDocument): void => {
    for (const page of original.presentation.pages)
      expect(adopted.presentation.pages.find(({ id }) => id === page.id)).toEqual(page)
  }

  it('measures the fixtures this suite relies on', () => {
    const maximum = withCreatedPages(50)
    expect(maximum.presentation.pages).toHaveLength(50)
    expect(maximum.presentation.pages.some(({ path }) => path === '/contact')).toBe(false)
    const near = withinBytes(200)
    expect(bytes(near)).toBe(DOCUMENT_BYTES - 200)
    expect(bytes(CONTACT_SOURCE)).toBeGreaterThan(200)
  })

  it.each([
    ['at the 50-page maximum', () => withCreatedPages(50)],
    [
      'at the 50-page maximum with a created page on the reserved Contact identity',
      () => withCreatedPages(50, true),
    ],
    ['within 200 bytes of the 2 MiB document budget', () => withinBytes(200)],
  ])('keeps the document publishable %s without dropping an owner page', (_label, build) => {
    const document = build()
    accepted(document)
    const adopted = ensureCorePages(document, sourcePages())
    expect(() => accepted(adopted)).not.toThrow()
    expectOwnerPagesKept(document, adopted)
    // No room remains for Contact; the Worker keeps serving its static Contact page.
    expect(adopted.presentation.pages.some(({ path }) => path === '/contact')).toBe(false)
    expect(ensureCorePages(adopted, sourcePages())).toEqual(adopted)
  })

  it('adds Contact beside a created page on the reserved Contact identity', () => {
    const document = withCreatedPages(7, true)
    accepted(document)
    const adopted = ensureCorePages(document, sourcePages())
    expect(() => accepted(adopted)).not.toThrow()
    expectOwnerPagesKept(document, adopted)
    const contact = adopted.presentation.pages.filter(({ path }) => path === '/contact')
    expect(contact).toHaveLength(1)
    // The owner's page keeps its identity; Contact takes one no other page uses.
    expect(ids(document)).not.toContain(contact[0]?.id)
    expect(contact[0]?.content).toEqual(CONTACT_SOURCE.content)
    // Every snapshot of one draft must agree on Contact's identity.
    expect(ensureCorePages(document, sourcePages())).toEqual(adopted)
    expect(ensureCorePages(adopted, sourcePages())).toEqual(adopted)
  })

  it('still adds Contact under its reserved identity below the maximum', () => {
    const document = withCreatedPages(49)
    accepted(document)
    const adopted = ensureCorePages(document, sourcePages())
    expect(() => accepted(adopted)).not.toThrow()
    expect(adopted.presentation.pages).toHaveLength(50)
    expectOwnerPagesKept(document, adopted)
    expect(adopted.presentation.pages.at(-1)).toEqual(CONTACT_SOURCE)
  })
})

describe('retained Contact through history restore and import (G07)', () => {
  afterEach(() => retainCorePageLayouts(emptyDocument()))
  const current = (contactId: string): { document: CmsDocument; contact: CmsPage } => {
    const document = revision56()
    const contact = contactPage(contactId, OWNER_CONTACT)
    document.presentation.pages.push(contact)
    accepted(document)
    return { document, contact }
  }

  it.each([
    ['a historical identity', HISTORICAL_CONTACT_ID],
    ['its reserved identity', CORE_PAGE_IDS[6]],
  ])(
    'keeps the current Contact with %s when the incoming revision predates Contact',
    (_label, contactId) => {
      const { document, contact } = current(contactId)
      // A complete current publication needs no source: Studio retains its stored layouts.
      expect(canOpenStoredPages(document)).toBe(true)
      expect(hasCorePageLayouts(document)).toBe(true)
      retainCorePageLayouts(document)
      const incoming = revision56()
      accepted(incoming)
      for (const [path, adopted] of [
        ['history restore', ensureCorePages(restoreRevision(incoming, document).document)],
        ['import', ensureCorePages(JSON.parse(JSON.stringify(incoming)) as CmsDocument)],
      ] as const) {
        expect(
          adopted.presentation.pages.find((page) => page.path === '/contact'),
          path,
        ).toEqual(contact)
        expect(() => accepted(adopted), path).not.toThrow()
      }
    },
  )

  it.each([
    ['a historical identity', HISTORICAL_CONTACT_ID],
    ['its reserved identity', CORE_PAGE_IDS[6]],
  ])(
    'keeps the current Contact with %s beside an incoming page on that identity',
    (_label, contactId) => {
      const { document, contact } = current(contactId)
      retainCorePageLayouts(document)
      const incoming = revision56()
      const owner = createSitePage({
        id: contactId,
        path: '/hemsida',
        name: { sv: 'Hemsida', en: 'Home page' },
      })
      incoming.presentation.pages.push(owner)
      accepted(incoming)
      const adopted = ensureCorePages(incoming)
      expect(() => accepted(adopted)).not.toThrow()
      for (const page of incoming.presentation.pages)
        expect(adopted.presentation.pages.find(({ id }) => id === page.id)).toEqual(page)
      const contacts = adopted.presentation.pages.filter(({ path }) => path === '/contact')
      expect(contacts).toHaveLength(1)
      expect(contacts[0]?.content).toEqual(contact.content)
      expect(ensureCorePages(incoming)).toEqual(adopted)
    },
  )

  it('never seeds a created page that holds a reserved identity into a restored revision', () => {
    const document = revision56()
    document.presentation.pages.push(
      createSitePage({
        id: CORE_PAGE_IDS[6],
        path: '/hemsida',
        name: { sv: 'Hemsida', en: 'Home page' },
      }),
    )
    accepted(document)
    retainCorePageLayouts(document)
    const restored = ensureCorePages(restoreRevision(revision56(), document).document)
    expect(restored.presentation.pages.map(({ path }) => path)).not.toContain('/hemsida')
  })
})

describe('historical Contact variants never block stored pages (G08)', () => {
  it.each([
    ['an empty Swedish body', { sv: '', en: OWNER_CONTACT.en }],
    ['an empty English body', { sv: OWNER_CONTACT.sv, en: '' }],
    ['both bodies empty', { sv: '', en: '' }],
    ['a complete body', OWNER_CONTACT],
  ])('opens the stored pages beside a historical Contact with %s', (_label, html) => {
    const document = revision56()
    // The missing-Contact control: stored pages open while source capture adds Contact later.
    expect(canOpenStoredPages(document)).toBe(true)
    document.presentation.pages.push(contactPage(HISTORICAL_CONTACT_ID, html))
    accepted(document)
    expect(canOpenStoredPages(document)).toBe(true)
  })

  it.each([
    ['an empty Swedish body', { sv: '', en: OWNER_CONTACT.en }],
    ['an empty English body', { sv: OWNER_CONTACT.sv, en: '' }],
    ['a complete body', OWNER_CONTACT],
  ])('keeps the authored bytes of a historical Contact with %s on source recovery', (_l, html) => {
    const document = revision56()
    const contact = contactPage(HISTORICAL_CONTACT_ID, html)
    document.presentation.pages.push(contact)
    const adopted = ensureCorePages(document, sourcePages())
    const upgraded = adopted.presentation.pages.filter(({ path }) => path === '/contact')
    expect(upgraded).toHaveLength(1)
    expect(upgraded[0]?.id).toBe(HISTORICAL_CONTACT_ID)
    for (const lang of ['sv', 'en'] as const)
      if (html[lang]) expect(upgraded[0]?.content[lang]).toEqual(contact.content[lang])
  })

  it.each([
    ['an empty Swedish body', { sv: '', en: OWNER_CONTACT.en }],
    ['an empty English body', { sv: OWNER_CONTACT.sv, en: '' }],
    ['both bodies empty', { sv: '', en: '' }],
  ])('fills only the empty variants of a historical Contact with %s', (_l, html) => {
    const document = revision56()
    const contact = contactPage(HISTORICAL_CONTACT_ID, html)
    document.presentation.pages.push(contact)
    accepted(document)
    const adopted = ensureCorePages(document, sourcePages())
    expect(() => accepted(adopted)).not.toThrow()
    const upgraded = adopted.presentation.pages.filter(({ path }) => path === '/contact')
    expect(upgraded).toHaveLength(1)
    expect(upgraded[0]?.id).toBe(HISTORICAL_CONTACT_ID)
    for (const lang of ['sv', 'en'] as const) {
      const { css } = contact.content[lang]
      const template = CONTACT_SOURCE.content[lang]
      // The owner's sheet for the empty variant follows the template's sheet.
      expect(upgraded[0]?.content[lang]).toEqual(
        html[lang]
          ? contact.content[lang]
          : {
              html: template.html,
              css: {
                light: `${template.css.light}\n${css.light}`,
                dark: `${template.css.dark}\n${css.dark}`,
              },
            },
      )
    }
    expect(hasCorePageLayouts(adopted)).toBe(true)
    expect(ensureCorePages(adopted, sourcePages())).toEqual(adopted)
  })

  it('keeps an empty Contact variant empty when filling it would exceed the document budget', () => {
    const base = revision56()
    base.presentation.pages.push(contactPage(HISTORICAL_CONTACT_ID, { sv: '', en: '' }))
    const document = withinBytes(20, base)
    accepted(document)
    expect(ensureCorePages(document, sourcePages())).toEqual(document)
  })

  it('upgrades a document publication already rejects as before', () => {
    // 51 pages: publication rejects it with or without Contact, so the upgrade proceeds.
    const document = withCreatedPages(51)
    expect(() => validateDocument(document)).toThrow('pages: Expected at most 50 items')
    const adopted = ensureCorePages(document, sourcePages())
    expect(adopted.presentation.pages.at(-1)).toEqual(CONTACT_SOURCE)
  })
})
