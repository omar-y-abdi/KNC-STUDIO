import { describe, expect, it, vi } from 'vitest'
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
    expect(draft.hasEdits).toBe(true)
    expect(draft.revision).toBe(2)
  })
})

describe('CMS draft interaction cost', () => {
  it('does not serialize unchanged snapshots again when the workspace rerenders', () => {
    const draft = new CmsDraft(emptyDocument(), 1, 'head')
    const next = structuredClone(draft.document)
    next.settings.business_name = 'Edited'
    draft.change(next)
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      for (let render = 0; render < 20; render++) {
        expect(draft.dirty).toBe(true)
        expect(draft.hasEdits).toBe(true)
      }
      const reads = stringify.mock.calls.filter(
        ([value]) => value === draft.document || value === draft.base,
      )
      expect(reads.length).toBeLessThanOrEqual(2)
      draft.undo()
      expect(draft.dirty).toBe(false)
      draft.redo()
      expect(draft.dirty).toBe(true)
      draft.base = structuredClone(draft.document)
      expect(draft.dirty).toBe(false)
      draft.base = emptyDocument()
      expect(draft.dirty).toBe(true)
    } finally {
      stringify.mockRestore()
    }
  })

  it('serializes only the new snapshot per change and reuses it for the dirty state', () => {
    const draft = new CmsDraft(emptyDocument(), 1, 'head')
    expect(draft.dirty).toBe(false)
    const previous = draft.document
    const next = structuredClone(previous)
    next.settings.business_name = 'Edited'
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      const serialized = () =>
        stringify.mock.calls.filter(
          ([value]) => value === next || value === previous || value === draft.base,
        ).length
      draft.change(next)
      expect(serialized()).toBe(1)
      expect(draft.dirty).toBe(true)
      expect(serialized()).toBe(1)
    } finally {
      stringify.mockRestore()
    }
  })

  it('keeps no-op and undo semantics with cached serializations', () => {
    const draft = new CmsDraft(emptyDocument(), 1, 'head')
    draft.change(structuredClone(draft.document))
    expect(draft.undo()).toBe(false)
    expect(draft.dirty).toBe(false)

    const next = structuredClone(draft.document)
    next.settings.business_name = 'Edited'
    draft.change(next)
    draft.change(structuredClone(next))
    expect(draft.dirty).toBe(true)
    expect(draft.undo()).toBe(true)
    expect(draft.dirty).toBe(false)
    expect(draft.undo()).toBe(false)
  })
})

describe('CMS draft recovery eligibility', () => {
  const migrate = (document: ReturnType<typeof emptyDocument>) => ({
    ...document,
    settings: { ...document.settings, tagline: 'Migrated source' },
  })
  const follow = () => undefined

  it('keeps migrations unpublished without treating them as author edits', () => {
    const raw = emptyDocument()
    const draft = new CmsDraft(migrate(raw), 1, 'head', raw)
    expect(draft.dirty).toBe(true)
    expect(draft.hasEdits).toBe(false)
    draft.change({
      ...draft.document,
      settings: { ...draft.document.settings, business_name: 'Owner edit' },
    })
    // A source response after editing must migrate the independent unedited snapshot as well.
    const source = (document: ReturnType<typeof emptyDocument>) => ({
      ...document,
      settings: { ...document.settings, business_city: 'Source addition' },
    })
    draft.migrate(source, follow)
    expect(draft.hasEdits).toBe(true)
    expect(draft.undo()).toBe(true)
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(true)
    expect(draft.redo()).toBe(true)
    expect(draft.hasEdits).toBe(true)

    draft.revert()
    draft.migrate((document) => source(migrate(document)), follow)
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(true)
    expect(draft.base).toEqual(raw)
    const request = draft.beginSave()
    draft.acknowledge(request.document, 2, 'published')
    expect(draft.dirty).toBe(false)
    expect(draft.hasEdits).toBe(false)
  })

  it('does not reuse an editing baseline after the authoritative base changes', () => {
    const raw = emptyDocument()
    const draft = new CmsDraft(migrate(raw), 1, 'head', raw)
    draft.base = { ...raw, settings: { business_name: 'New server content' } }
    expect(draft.hasEdits).toBe(true)
    draft.migrate(migrate, follow)
    expect(draft.hasEdits).toBe(true)
    draft.revert()
    draft.migrate(migrate, follow)
    expect(draft.hasEdits).toBe(false)
    expect(draft.document.settings.business_name).toBe('New server content')
    expect(draft.dirty).toBe(true)
  })
})

describe('CMS draft amendment', () => {
  it('completes the current transaction without an undo step of its own', () => {
    const draft = new CmsDraft(emptyDocument(), 1, 'head')
    const assigned = structuredClone(draft.document)
    assigned.settings.business_name = 'Data'
    draft.change(assigned, 'resources')
    const captured = structuredClone(assigned)
    captured.settings.business_city = 'Layout'
    draft.amend(captured)
    expect(draft.document).toBe(captured)
    expect(draft.undo()).toBe(true)
    expect(draft.dirty).toBe(false)
    expect(draft.redo()).toBe(true)
    expect(draft.document).toBe(captured)
  })

  it('migrates every retained snapshot without an undo step and keeps the raw base', () => {
    const draft = new CmsDraft(emptyDocument(), 1, '0123456789abcdef0123456789abcdef')
    const raw = draft.base
    for (const name of ['A', 'B', 'C']) {
      const next = structuredClone(draft.document)
      next.settings.business_name = name
      draft.change(next)
    }
    expect(draft.undo()).toBe(true)
    const adopted: [string | undefined, string | undefined][] = []
    draft.migrate(
      (document) => {
        const next = structuredClone(document)
        next.settings.tagline = 'migrated'
        return next
      },
      (previous, next) => adopted.push([previous.settings.business_name, next.settings.tagline]),
    )
    expect(draft.document.settings).toMatchObject({ business_name: 'B', tagline: 'migrated' })
    expect(adopted).toHaveLength(4)
    expect(draft.base).toBe(raw)
    expect(draft.dirty).toBe(true)
    while (draft.undo()) expect(draft.document.settings.tagline).toBe('migrated')
    expect(draft.document.settings.business_name).toBeUndefined()
    while (draft.redo()) expect(draft.document.settings.tagline).toBe('migrated')
    expect(draft.document.settings.business_name).toBe('C')
  })
})
