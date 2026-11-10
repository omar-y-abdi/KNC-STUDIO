import { describe, expect, it } from 'vitest'
import {
  emptyDocument,
  validateDocument,
  type CmsDocument,
  type CmsPage,
} from '../../packages/content-contracts/src/cms'
import { CMS_BUILT_ASSETS } from '../../packages/content-contracts/src/cms-built-assets'
import { validateDocumentMarkupPlacements } from '../../packages/content-contracts/src/cms-markup'
import { nativeCanvas } from '../../modules/studio/src/nativeCanvas'
import {
  ensureCorePages,
  needsCorePageSource,
  retainCorePageLayouts,
} from '../../modules/studio/src/corePages'
import { CmsDraft, restoreRevision } from '../../modules/studio/src/draft'
import type { CmsBackup } from '../../modules/studio/src/backup'
import { normalizeDesktopCss, normalizeDocument } from '../../modules/studio/src/normalizeDocument'

const legacyCss =
  '@media(max-width:1440px){#owner-offset{translate:12px 0!important}}' +
  '@media(max-width:1440px){.source{display:none}}' +
  '@media(max-width:768px){#owner-offset{translate:3px 0!important}}'
const repairedCss =
  '@media (min-width:769px){#owner-offset{translate:12px 0!important}}' +
  '@media (max-width:1440px){.source{display:none}}' +
  '@media (max-width:768px){#owner-offset{translate:3px 0!important}}'

function storedDocument(): CmsDocument {
  const document = emptyDocument()
  const variant = {
    html: '<p id="owner-offset">Owner wording</p>',
    css: { light: legacyCss, dark: legacyCss },
  }
  const page: CmsPage = {
    id: '10000000-0000-4000-8000-000000000002',
    path: '/about',
    kind: 'page',
    name: { sv: 'Om oss', en: 'About' },
    title: { sv: 'Om oss', en: 'About' },
    description: { sv: '', en: '' },
    inMenu: true,
    content: { sv: structuredClone(variant), en: structuredClone(variant) },
  }
  document.presentation.pages = [
    page,
    {
      ...structuredClone(page),
      id: '10000000-0000-4000-8000-000000000003',
      path: '/booking',
    },
  ]
  return document
}

const paths: [string, (document: CmsDocument) => CmsDocument][] = [
  ['load', (document) => structuredClone(document)],
  [
    'backup restore',
    (document) => {
      const backup: CmsBackup = {
        document: structuredClone(document),
        savedAt: '2026-10-25T00:00:00.000Z',
      }
      return backup.document
    },
  ],
  ['history restore', (document) => restoreRevision(document, emptyDocument()).document],
  ['import', (document) => JSON.parse(JSON.stringify(document)) as CmsDocument],
]

describe('Studio document adoption', () => {
  it.each(paths)(
    'repairs Desktop CSS on %s before the next publish without mutating the input',
    (_path, incoming) => {
      const stored = storedDocument()
      const input = incoming(stored)
      const before = structuredClone(input)
      const adopted = normalizeDocument(input)
      expect(adopted).not.toBe(input)
      for (const page of adopted.presentation.pages)
        for (const lang of ['sv', 'en'] as const) {
          expect(page.content[lang].html).toBe('<p id="owner-offset">Owner wording</p>')
          for (const mode of ['light', 'dark'] as const)
            expect(page.content[lang].css[mode]).toBe(repairedCss)
        }
      expect(input).toEqual(before)
      expect(stored).toEqual(before)
    },
  )

  it('keeps an already repaired document and its sheets by identity on repeated adoption', () => {
    const adopted = normalizeDocument(storedDocument())
    expect(adopted.presentation.pages[0]?.content.en.css.dark).toBe(repairedCss)
    expect(normalizeDocument(adopted)).toBe(adopted)
    const current = emptyDocument()
    expect(normalizeDocument(current)).toBe(current)
  })

  it('keeps reviewed-history and adopted canvas output identical in both schemes', () => {
    const stored = storedDocument()
    const raw = stored.presentation.pages[0]?.content.en
    // A history review repairs the revision it reads without adopting it.
    const reviewed = normalizeDesktopCss(stored).presentation.pages[0]?.content.en
    const adopted = normalizeDocument(stored)
    const variant = adopted.presentation.pages[0]?.content.en
    if (!variant || !raw || !reviewed) throw new Error('The About variant is missing')
    for (const mode of ['light', 'dark'] as const) {
      expect(nativeCanvas(reviewed, mode)).toEqual({
        html: raw.html,
        css: 'body{background-color:inherit;color:inherit}' + repairedCss,
      })
      expect(nativeCanvas(variant, mode)).toEqual(nativeCanvas(reviewed, mode))
      expect(raw.css[mode]).toBe(legacyCss)
    }
  })
})

// Accepted owner sheets that only mention the old Desktop width. None holds a legacy ID-rule
// breakpoint, so adoption must keep them byte for byte (G16).
const ordinarySheets: [string, string][] = [
  [
    'a commented class query',
    '/* Owner comment */\n@media (max-width: 1440px) {\n  .price {\n    color: red;\n  }\n}\n',
  ],
  ['a string literal', ".note::after {\n  content: 'max-width: 1440px';\n}\n"],
  [
    'a commented-out legacy rule',
    '/* @media(max-width:1440px){#owner{width:10px}} */\np { color: red; }\n',
  ],
]

function contactDocument(css: string): CmsDocument {
  const document = emptyDocument()
  const variant = (heading: string) => ({
    html: `<main class="bb-page bb-doc"><h1 class="price note">${heading}</h1><p>Text</p></main>`,
    css: { light: css, dark: css },
  })
  document.presentation.pages = [
    {
      id: '10000000-0000-4000-8000-000000000007',
      path: '/contact',
      kind: 'page',
      name: { sv: 'Kontakt', en: 'Contact' },
      title: { sv: '', en: '' },
      description: { sv: '', en: '' },
      inMenu: false,
      content: { sv: variant('Kontakt'), en: variant('Contact') },
    },
  ]
  validateDocument(document)
  validateDocumentMarkupPlacements(document, {
    siteOrigin: 'https://bladeblendstudio.se',
    storageOrigin: 'https://admin-harness.invalid',
    builtAssets: CMS_BUILT_ASSETS,
  })
  return document
}

describe('Studio adoption of ordinary Desktop-width CSS (G16)', () => {
  const cases = paths.flatMap(([path, incoming]) =>
    ordinarySheets.map(([sheet, css]) => [path, sheet, incoming, css] as const),
  )

  it.each(cases)('keeps the stored document on %s with %s', (_path, _sheet, incoming, css) => {
    const input = incoming(contactDocument(css))
    expect(normalizeDocument(input)).toBe(input)
  })

  it.each(ordinarySheets)('keeps %s through the source adoption migration', (_sheet, css) => {
    const stored = contactDocument(css)
    // The source upgrade Studio runs once the capture arrives, with the stored Contact retained.
    retainCorePageLayouts(stored)
    try {
      expect(needsCorePageSource(stored)).toBe(true)
      const draft = new CmsDraft(stored, 1, 'revision-1', stored)
      draft.migrate(
        (document) =>
          normalizeDocument(needsCorePageSource(document) ? ensureCorePages(document) : document),
        () => undefined,
      )
      expect(draft.dirty).toBe(false)
      expect(draft.hasEdits).toBe(false)
      for (const lang of ['sv', 'en'] as const)
        expect(draft.document.presentation.pages[0]?.content[lang].css).toEqual({
          light: css,
          dark: css,
        })
    } finally {
      retainCorePageLayouts(emptyDocument())
    }
  })

  it.each(ordinarySheets)(
    'opens, publishes and acknowledges %s without a phantom migration',
    (_sheet, css) => {
      const published = contactDocument(css)
      // Refresh: the Studio adopts the server snapshot and keeps the raw one as its base.
      const draft = new CmsDraft(normalizeDocument(published), 1, 'revision-1', published)
      expect(draft.dirty).toBe(false)
      expect(draft.hasEdits).toBe(false)
      const edited = structuredClone(draft.document)
      const contact = edited.presentation.pages[0]
      if (!contact) throw new Error('Missing Contact page')
      contact.name.sv = 'Kontakta oss'
      draft.change(edited)
      const request = draft.beginSave()
      expect(request.document.presentation.pages[0]?.content.sv.css.light).toBe(css)
      // The server stores and returns what was sent; Studio adopts the acknowledgement.
      draft.acknowledge(request.document, 2, 'revision-2', normalizeDocument(request.document))
      expect(draft.dirty).toBe(false)
      expect(draft.hasEdits).toBe(false)
      for (const lang of ['sv', 'en'] as const)
        expect(draft.document.presentation.pages[0]?.content[lang].css).toEqual({
          light: css,
          dark: css,
        })
    },
  )
})
