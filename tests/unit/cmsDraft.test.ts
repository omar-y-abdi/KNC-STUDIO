import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../../shared/cms'
import { CmsDraft } from '../../src/admin/cms/draft'

describe('CMS draft', () => {
  it('undoes grouped edits and preserves an idempotent pending publication', () => {
    const base = emptyDocument()
    const draft = new CmsDraft(base, 3, '0123456789abcdef0123456789abcdef')
    const a = structuredClone(draft.document)
    a.settings.business_name = 'A'
    draft.change(a, 'business-name')
    const b = structuredClone(draft.document)
    b.settings.business_name = 'AB'
    draft.change(b, 'business-name')

    expect(draft.undo()).toBe(true)
    expect(draft.document.settings.business_name).toBeUndefined()
    expect(draft.redo()).toBe(true)
    expect(draft.document.settings.business_name).toBe('AB')

    const first = draft.beginSave()
    const second = draft.beginSave()
    expect(second.requestId).toBe(first.requestId)
    expect(second.document).toEqual(first.document)
  })

  it('keeps newer edits dirty when an older save is acknowledged', () => {
    const draft = new CmsDraft(emptyDocument(), 1, '0123456789abcdef0123456789abcdef')
    const saveDocument = structuredClone(draft.document)
    saveDocument.settings.business_name = 'Saved'
    draft.change(saveDocument)
    const pending = draft.beginSave()
    const newer = structuredClone(draft.document)
    newer.settings.business_name = 'Newer'
    draft.change(newer)

    draft.acknowledge(pending.document, 2, 'abcdef0123456789abcdef0123456789')
    expect(draft.document.settings.business_name).toBe('Newer')
    expect(draft.dirty).toBe(true)
    expect(draft.revision).toBe(2)
  })
})
