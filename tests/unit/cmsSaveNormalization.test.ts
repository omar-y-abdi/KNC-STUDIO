import { expect, it } from 'vitest'
import { emptyDocument } from '../../shared/cms'
import { CmsDraft } from '../../src/admin/cms/draft'

it('accepts server normalization without leaving an unchanged saved draft dirty', () => {
  const draft = new CmsDraft(emptyDocument(), 1, 'old')
  draft.beginSave()
  const normalized = structuredClone(draft.document)
  normalized.settings.business_name = 'Normalized by the server'
  draft.acknowledge(normalized, 2, 'new')
  expect(draft.document).toEqual(normalized)
  expect(draft.dirty).toBe(false)
})
