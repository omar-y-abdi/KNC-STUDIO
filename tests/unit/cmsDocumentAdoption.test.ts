import { describe, expect, it } from 'vitest'
import { emptyDocument, type CmsDocument, type CmsPage } from '../../shared/cms'
import { nativeCanvas } from '../../src/admin/cms/nativeCanvas'
import { restoreRevision } from '../../src/admin/cms/draft'
import type { CmsBackup } from '../../src/admin/cms/backup'
import { normalizeDocument } from '../../src/admin/cms/normalizeDocument'

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

describe('Studio document adoption', () => {
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

  it('keeps raw-history and adopted canvas output identical in both schemes', () => {
    const stored = storedDocument()
    const raw = stored.presentation.pages[0]?.content.en
    const adopted = normalizeDocument(stored)
    const variant = adopted.presentation.pages[0]?.content.en
    if (!variant || !raw) throw new Error('The About variant is missing')
    for (const mode of ['light', 'dark'] as const) {
      expect(nativeCanvas(raw, mode)).toEqual({
        html: raw.html,
        css: 'body{background-color:inherit;color:inherit}' + repairedCss,
      })
      expect(nativeCanvas(variant, mode)).toEqual(nativeCanvas(raw, mode))
      expect(raw.css[mode]).toBe(legacyCss)
    }
  })
})
