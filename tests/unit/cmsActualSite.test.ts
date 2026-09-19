import { expect, it } from 'vitest'
import { emptyDocument } from '../../shared/cms'
import { ensureCorePages } from '../../src/admin/cms/corePages'

it('does not invent a replacement website when the CMS has no authored pages', () => {
  const document = emptyDocument()
  expect(ensureCorePages(document)).toEqual(document)
})
