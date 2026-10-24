import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { emptyDocument, type CmsDocument, type CmsPage } from '../../shared/cms'
import { LEGACY_LEGAL_CSS, upgradeLegacyLegalPages } from '../../src/admin/cms/legacyLegal'

// The constants are copies of git objects at c202df2. CI checks out one commit, so the copies are
// pinned by hash: `git show c202df2:public/info.css | shasum -a 256` and, for /privacy, the text
// between <style> and </style> of `git show c202df2:public/privacy.html`.
const GIT_OBJECTS = {
  '/terms': {
    bytes: 956,
    sha256: 'fa87e531c31dd1af0b5e9e8a4453b96158be2efaf84fc1dadb2913ad7888605c',
  },
  '/privacy': {
    bytes: 1894,
    sha256: '8fdaa3a3a670556b486e8b17f445292f44e57b95222ad2a432c29c13fa93913c',
  },
} as const

const fixture = (): CmsDocument => ({
  ...emptyDocument(),
  presentation: JSON.parse(
    gunzipSync(
      readFileSync(new URL('../../tools/e2e/fixtures/presentation.json.gz', import.meta.url)),
    ).toString(),
  ).presentation,
})
const legal = (document: CmsDocument, path: '/terms' | '/privacy'): CmsPage => {
  const page = document.presentation.pages.find((item) => item.path === path)
  if (!page) throw new Error(`The fixture has no ${path}`)
  return page
}
const sheets = (page: CmsPage): string[] =>
  (['sv', 'en'] as const).flatMap((lang) => [
    page.content[lang].css.light,
    page.content[lang].css.dark,
  ])
const editSheets = (page: CmsPage, edit: (css: string) => string): void => {
  for (const lang of ['sv', 'en'] as const)
    for (const mode of ['light', 'dark'] as const)
      page.content[lang].css[mode] = edit(page.content[lang].css[mode])
}

describe('legacy legal page upgrade (STY-7)', () => {
  it.each(Object.entries(GIT_OBJECTS))('copies %s byte for byte from git', (path, object) => {
    const legacy = LEGACY_LEGAL_CSS[path as keyof typeof LEGACY_LEGAL_CSS]
    expect(Buffer.byteLength(legacy)).toBe(object.bytes)
    expect(createHash('sha256').update(legacy).digest('hex')).toBe(object.sha256)
  })

  it.each(['/terms', '/privacy'] as const)(
    'strips the fixture %s legacy CSS and gives its one main the document class',
    (path) => {
      const before = legal(fixture(), path)
      const after = legal(upgradeLegacyLegalPages(fixture()), path)
      expect(sheets(before).every((css) => css === LEGACY_LEGAL_CSS[path])).toBe(true)
      expect(sheets(after)).toEqual(['', '', '', ''])
      for (const lang of ['sv', 'en'] as const) {
        const inner = /^\s*<main>([\s\S]*)<\/main>\s*$/.exec(before.content[lang].html)?.[1]
        expect(after.content[lang].html).toBe(
          before.content[lang].html.replace(
            `<main>${inner}</main>`,
            `<main class="bb-doc">${inner}</main>`,
          ),
        )
        expect(after.content[lang].html.match(/<main\b/g)).toHaveLength(1)
      }
    },
  )

  it('keeps owner CSS around the legacy block byte for byte', () => {
    const document = fixture()
    editSheets(legal(document, '/terms'), (css) => `.owner{color:red}\n${css}\n.after{margin:0}`)
    expect(sheets(legal(upgradeLegacyLegalPages(document), '/terms'))).toEqual(
      Array(4).fill('.owner{color:red}\n\n.after{margin:0}'),
    )
  })

  it.each([
    [
      'a one-byte difference in the legacy text',
      (page: CmsPage) => editSheets(page, (css) => css.replace('46rem', '47rem')),
    ],
    ['one sheet without the legacy text', (page: CmsPage) => (page.content.en.css.dark = '')],
    [
      'a main with attributes',
      (page: CmsPage) =>
        (page.content.sv.html = page.content.sv.html.replace('<main>', '<main id="x">')),
    ],
    ['content beside the main', (page: CmsPage) => (page.content.en.html += '<p>after</p>')],
  ])('leaves the page untouched on %s', (_case, change) => {
    const document = fixture()
    change(legal(document, '/terms'))
    const expected = structuredClone(legal(document, '/terms'))
    expect(legal(upgradeLegacyLegalPages(document), '/terms')).toEqual(expected)
  })

  it('is a no-op on its own output and on documents without legacy CSS', () => {
    const once = upgradeLegacyLegalPages(fixture())
    expect(upgradeLegacyLegalPages(once)).toBe(once)
    const empty = emptyDocument()
    expect(upgradeLegacyLegalPages(empty)).toBe(empty)
  })
})
