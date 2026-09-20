import { expect, it } from 'vitest'
import { emptyDocument } from '../../shared/cms'
import { CmsDraft } from '../../src/admin/cms/draft'

it('keeps new edits and unrelated server normalization after publication', () => {
  const draft = new CmsDraft(emptyDocument(), 1, 'old')
  const request = draft.beginSave()
  const local = structuredClone(draft.document)
  local.settings.contact_email = 'owner@example.com'
  draft.change(local)
  const normalized = structuredClone(request.document)
  normalized.settings.business_name = 'Normalized by the server'
  draft.acknowledge(normalized, 2, 'new')
  expect(draft.document.settings).toEqual({
    business_name: 'Normalized by the server',
    contact_email: 'owner@example.com',
  })
  expect(draft.base).toEqual(normalized)
  expect(draft.dirty).toBe(true)
  const retry = draft.beginSave()
  expect(retry.baseRevision).toBe(2)
  expect(retry.baseFingerprint).toBe('new')
  expect(retry.requestId).not.toBe(request.requestId)
  expect(retry.document).toEqual(draft.document)
})

it('keeps retry identity and separates undo groups at publication', () => {
  const draft = new CmsDraft(emptyDocument(), 1, 'old')
  const first = structuredClone(draft.document)
  first.settings.business_name = 'First edit'
  draft.change(first, 'business')
  const request = draft.beginSave()
  expect(draft.beginSave()).toBe(request)
  draft.acknowledge(request.document, 2, 'new')
  const second = structuredClone(draft.document)
  second.settings.business_name = 'Second edit'
  draft.change(second, 'business')
  expect(draft.undo()).toBe(true)
  expect(draft.document.settings.business_name).toBe('First edit')
  expect(draft.dirty).toBe(false)
  expect(draft.redo()).toBe(true)
  expect(draft.document.settings.business_name).toBe('Second edit')
})
