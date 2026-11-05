import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

const templates = Object.fromEntries(
  ['/privacy', '/terms', '/contact'].map((path) => [
    path,
    readFileSync(new URL(`../../public${path}.html`, import.meta.url), 'utf8'),
  ]),
)

test('adding a missing Contact preserves complete owner information pages byte for byte', async ({
  page,
}) => {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  const result = await page.evaluate(async (templates) => {
    const { emptyDocument, validateDocument } = await import('/shared/cms.ts')
    const { validateDocumentMarkupPlacements } = await import('/shared/cms-markup.ts')
    const { CORE_PAGE_IDS, ensureCorePages } = await import('/src/admin/cms/corePages.ts')
    const source = Object.entries(templates).map(([path, template], index) => {
      const parsed = new globalThis.DOMParser().parseFromString(template, 'text/html')
      const css = [...parsed.querySelectorAll('style')]
        .map((style) => style.textContent ?? '')
        .join('\n')
      const variant = { html: parsed.body.innerHTML, css: { light: css, dark: css } }
      return {
        id: CORE_PAGE_IDS[index + 4],
        path,
        kind: path === '/contact' ? 'page' : path.slice(1),
        name: { sv: path, en: path },
        title: { sv: path, en: path },
        description: { sv: '', en: '' },
        inMenu: false,
        content: {
          sv: globalThis.structuredClone(variant),
          en: globalThis.structuredClone(variant),
        },
      }
    })
    const document = emptyDocument()
    document.presentation.pages = globalThis.structuredClone(
      source.filter((item) => item.path !== '/contact'),
    )
    for (const page of document.presentation.pages)
      for (const lang of ['sv', 'en']) {
        page.content[lang].html += `<p class="owner-copy">Owner ${lang} ${page.path}</p>\n`
        page.content[lang].css.dark += '\n.owner-copy { padding: 23px; }'
      }
    // Canonicalize through the publication validator first: these are accepted owner bodies,
    // including leading whitespace that fragment validation retains.
    validateDocument(document)
    validateDocumentMarkupPlacements(document, {
      siteOrigin: globalThis.location.origin,
      storageOrigin: 'https://storage.invalid',
    })
    const before = globalThis.structuredClone(document)
    const next = ensureCorePages(document, source)
    return {
      expected: before.presentation.pages,
      actual: next.presentation.pages.filter((item) => item.path !== '/contact'),
      inputUnchanged: JSON.stringify(document) === JSON.stringify(before),
      contactCount: next.presentation.pages.filter((item) => item.path === '/contact').length,
    }
  }, templates)
  expect(result.inputUnchanged).toBe(true)
  expect(result.contactCount).toBe(1)
  expect(result.actual).toEqual(result.expected)
})
