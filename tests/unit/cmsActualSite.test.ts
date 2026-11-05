import { expect, it } from 'vitest'
import { emptyDocument } from '../../packages/content-contracts/src/cms'
import { ensureCorePages } from '../../modules/studio/src/corePages'

it('does not invent a replacement website when the CMS has no authored pages', () => {
  const document = emptyDocument()
  expect(ensureCorePages(document)).toEqual(document)
})
