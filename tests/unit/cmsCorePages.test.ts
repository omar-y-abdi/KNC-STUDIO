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
