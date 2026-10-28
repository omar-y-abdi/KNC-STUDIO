import { describe, expect, it, vi } from 'vitest'
import { emptyDocument } from '../../shared/cms'
import { createSitePage } from '../../shared/site-page'
import { CmsDraft, mergeCmsDocuments } from '../../src/admin/cms/draft'
import { normalizeDocument } from '../../src/admin/cms/normalizeDocument'

function legacyDocument() {
  const document = emptyDocument()
  const page = createSitePage({
    id: '10000000-0000-4000-8000-000000000099',
    path: '/pristine',
    name: { sv: 'Äldre sida', en: 'Legacy page' },
  })
  page.layout = 'independent'
  document.presentation.pages.push(page)
  return document
}

describe('CMS pristine adoption', () => {
  it('keeps a normalized load and refresh publishable without counting them as edits', () => {
    const raw = legacyDocument()
    const normalized = normalizeDocument(raw)
    expect(normalized).not.toEqual(raw)
    const draft = new CmsDraft(normalized, 1, 'head', raw)
    expect(draft.uneditedDocument).toEqual(normalized)
    expect(draft.uneditedDocument).not.toBe(normalized)
    expect(draft.base).toEqual(raw)
    expect(draft.dirty).toBe(true)
    expect(draft.hasEdits).toBe(false)
    draft.change(normalizeDocument(draft.document))
    expect(draft.hasEdits).toBe(false)
    expect(draft.undo()).toBe(false)

    const edit = structuredClone(draft.document)
    edit.settings.business_name = 'Discarded by refresh'
    draft.change(edit)
    expect(draft.hasEdits).toBe(true)
    // Studio refresh adopts the newly loaded head in a new draft.
    const refreshed = new CmsDraft(normalized, 2, 'refreshed', raw)
    expect(refreshed.uneditedDocument).toEqual(normalized)
    expect(refreshed.hasEdits).toBe(false)
    expect(refreshed.dirty).toBe(true)
  })

  it('reverts to the normalized pristine snapshot and keeps undo and redo meaningful', () => {
    const raw = legacyDocument()
    const draft = new CmsDraft(normalizeDocument(raw), 1, 'head', raw)
    draft.revert()
    expect(draft.undo()).toBe(false)
    const edit = structuredClone(draft.document)
    edit.settings.business_name = 'Owner edit'
    draft.change(edit)
    draft.revert()
    expect(draft.document).toEqual(draft.uneditedDocument)
    expect(draft.document).not.toEqual(raw)
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(true)
    expect(draft.undo()).toBe(true)
    expect(draft.document).toEqual(edit)
    expect(draft.hasEdits).toBe(true)
    expect(draft.redo()).toBe(true)
    expect(draft.hasEdits).toBe(false)
    draft.change(structuredClone(raw))
    expect(draft.dirty).toBe(false)
    expect(draft.hasEdits).toBe(true)
    draft.revert()
    expect(draft.document).toEqual(draft.uneditedDocument)
    expect(draft.hasEdits).toBe(false)
  })

  it('adopts the normalized save response as pristine while preserving newer local edits', () => {
    const draft = new CmsDraft(emptyDocument(), 1, 'old')
    draft.beginSave()
    const edit = structuredClone(draft.document)
    edit.settings.business_name = 'Edited during publication'
    draft.change(edit)
    const raw = legacyDocument()
    const normalized = normalizeDocument(raw)
    draft.acknowledge(raw, 2, 'saved', normalized)
    expect(draft.base).toEqual(raw)
    expect(draft.uneditedDocument).toEqual(normalized)
    expect(draft.document.settings.business_name).toBe('Edited during publication')
    expect(draft.document.presentation).toEqual(normalized.presentation)
    expect(draft.hasEdits).toBe(true)
    draft.revert()
    expect(draft.document).toEqual(normalized)
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(true)
    const saved = draft.beginSave()
    draft.acknowledge(saved.document, 3, 'published')
    expect(draft.uneditedDocument).toEqual(saved.document)
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(false)
  })

  it('compares conflict adoption and each resolution with the normalized remote head', () => {
    const base = legacyDocument()
    const local = structuredClone(normalizeDocument(base))
    local.settings.business_name = 'Local'
    const rawRemote = structuredClone(base)
    rawRemote.settings.business_name = 'Remote'
    const remote = normalizeDocument(rawRemote)
    for (const resolution of ['local', 'remote'] as const) {
      const resolved = normalizeDocument(
        mergeCmsDocuments(base, local, remote, resolution).document,
      )
      const draft = new CmsDraft(remote, 2, 'remote', rawRemote)
      draft.change(resolved)
      expect(draft.uneditedDocument).toEqual(remote)
      expect(draft.hasEdits).toBe(resolution === 'local')
      expect(draft.dirty).toBe(true)
      draft.revert()
      expect(draft.document).toEqual(remote)
      expect(draft.hasEdits).toBe(false)
    }
  })

  it('migrates pristine with the retained snapshots without erasing real edits', () => {
    const draft = new CmsDraft(legacyDocument(), 1, 'head')
    draft.migrate(normalizeDocument, () => undefined)
    expect(draft.uneditedDocument).toEqual(normalizeDocument(draft.base))
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(true)
    const edit = structuredClone(draft.document)
    edit.settings.business_name = 'Owner edit'
    draft.change(edit)
    draft.migrate(normalizeDocument, () => undefined)
    expect(draft.hasEdits).toBe(true)
    expect(draft.undo()).toBe(true)
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(true)
  })

  it('updates pristine even when the current snapshot is already normalized', () => {
    const draft = new CmsDraft(legacyDocument(), 1, 'head')
    draft.change(normalizeDocument(draft.document))
    const current = draft.document
    expect(draft.hasEdits).toBe(true)
    draft.migrate(normalizeDocument, () => undefined)
    expect(draft.document).toBe(current)
    expect(draft.uneditedDocument).toEqual(current)
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(true)
  })
})

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
  it('reuses edited comparisons until the document or pristine adoption changes', () => {
    const draft = new CmsDraft(emptyDocument(), 1, 'head')
    expect(draft.hasEdits).toBe(false)
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      for (let render = 0; render < 20; render++) expect(draft.hasEdits).toBe(false)
      expect(stringify).not.toHaveBeenCalled()
      const next = structuredClone(draft.document)
      next.settings.business_name = 'Edited'
      draft.change(next)
      for (let render = 0; render < 20; render++) expect(draft.hasEdits).toBe(true)
      expect(stringify).toHaveBeenCalledTimes(1)
      draft.undo()
      expect(draft.hasEdits).toBe(false)
      draft.redo()
      expect(draft.hasEdits).toBe(true)
      draft.beginSave()
      draft.acknowledge(next, 2, 'saved')
      expect(draft.hasEdits).toBe(false)
    } finally {
      stringify.mockRestore()
    }
  })

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

    draft.beginSave()
    draft.revert()
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(true)
    expect(draft.document.settings).toEqual({
      tagline: 'Migrated source',
      business_city: 'Source addition',
    })
    expect(draft.base).toEqual(raw)
    expect(draft.pending).toBe(null)
    expect(draft.undo()).toBe(true)
    expect(draft.document.settings.business_name).toBe('Owner edit')
    expect(draft.hasEdits).toBe(true)
    expect(draft.redo()).toBe(true)
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(true)
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
    expect(draft.hasEdits).toBe(false)
    expect(draft.document.settings.business_name).toBe('New server content')
    expect(draft.dirty).toBe(true)
  })

  it('preserves owner edits when adopting a different publication head before migration and Reset', () => {
    const raw = legacyDocument()
    const draft = new CmsDraft(normalizeDocument(raw), 1, 'original-head', raw)
    const edit = structuredClone(draft.document)
    edit.settings.business_name = 'Owner edit before conflict'
    draft.change(edit)
    const remote = structuredClone(raw)
    remote.settings.business_city = 'New server city'
    draft.base = remote
    draft.revision = 2
    draft.fingerprint = 'remote-head'
    expect(draft.uneditedDocument).toEqual(remote)
    expect(draft.hasEdits).toBe(true)
    draft.migrate(normalizeDocument, follow)
    expect(draft.document.settings.business_name).toBe('Owner edit before conflict')
    expect(draft.hasEdits).toBe(true)
    draft.revert()
    expect(draft.document).toEqual(normalizeDocument(remote))
    expect(draft.hasEdits).toBe(false)
    expect(draft.dirty).toBe(true)
    expect(draft.undo()).toBe(true)
    expect(draft.document.settings.business_name).toBe('Owner edit before conflict')
    expect(draft.hasEdits).toBe(true)
    expect(draft.redo()).toBe(true)
    expect(draft.document).toEqual(normalizeDocument(remote))
    expect(draft.hasEdits).toBe(false)
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
    expect(draft.uneditedDocument?.settings.tagline).toBe('migrated')
    expect(draft.hasEdits).toBe(true)
    while (draft.undo()) expect(draft.document.settings.tagline).toBe('migrated')
    expect(draft.document.settings.business_name).toBeUndefined()
    expect(draft.hasEdits).toBe(false)
    while (draft.redo()) expect(draft.document.settings.tagline).toBe('migrated')
    expect(draft.document.settings.business_name).toBe('C')
  })
})
