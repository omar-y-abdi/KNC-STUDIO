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

it('keeps edits made while a normalized save response is pending', () => {
  const draft = new CmsDraft(emptyDocument(), 1, 'old')
  const request = draft.beginSave()
  const editing = structuredClone(draft.document)
  editing.settings.business_name = 'Edited during save'
  draft.change(editing)
  const normalized = structuredClone(request.document)
  normalized.settings.business_name = 'Normalized by the server'
  draft.acknowledge(normalized, 2, 'new')
  expect(draft.document).toEqual(editing)
  expect(draft.base).toEqual(normalized)
  expect(draft.dirty).toBe(true)
  const next = draft.beginSave()
  expect(next.document).toEqual(editing)
  expect(next.baseRevision).toBe(2)
  expect(next.baseFingerprint).toBe('new')
  expect(next.requestId).not.toBe(request.requestId)
})
