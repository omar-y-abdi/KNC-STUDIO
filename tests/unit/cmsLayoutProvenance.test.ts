import { describe, expect, it } from 'vitest'
import { emptyDocument, type CmsDocument } from '../../shared/cms'
import { resourceLayoutsChanged } from '../../src/admin/cms/captureResourceLayouts'
import { CmsDraft, restoreRevision } from '../../src/admin/cms/draft'
import { LayoutProvenance } from '../../src/admin/cms/layoutProvenance'

const salonImage = {
  id: '7c000000-0000-4000-8000-000000000001',
  kind: 'salon' as const,
  storage_path: 'salon/7c000000-0000-4000-8000-000000000001.webp',
  alt: '',
  sort_order: 0,
}

const withGallery = (document: CmsDocument, gallery: CmsDocument['gallery']): CmsDocument => ({
  ...document,
  gallery,
})

// What a successful capture does: Home/About are rendered again for the draft's resource data.
function capture(draft: CmsDraft, layouts: LayoutProvenance, html: string): void {
  const next = structuredClone(draft.document)
  next.settings['captured_layout'] = html
  draft.amend(next)
  layouts.captured(next)
}

// What Studio's commitDraft does for an edit or a resource change.
function commit(draft: CmsDraft, layouts: LayoutProvenance, next: CmsDocument): void {
  const previous = draft.document
  draft.change(next)
  layouts.follow(previous, draft.document, draft.base)
}

describe('Home/About layout provenance', () => {
  it('keeps an uncaptured undo snapshot tied to the base before publication', () => {
    const layouts = new LayoutProvenance()
    const draft = new CmsDraft(emptyDocument(), 1, 'published')
    commit(draft, layouts, withGallery(draft.document, [salonImage]))
    // Assignment capture fails; a separate ordinary edit retains the old layouts in history.
    commit(draft, layouts, { ...draft.document, settings: { ...draft.document.settings, x: '1' } })
    capture(draft, layouts, 'with the salon image')
    const request = draft.beginSave()
    const local = { document: draft.document, stale: layouts.stale(draft.document, draft.base) }
    draft.acknowledge(request.document, 2, 'new publication')
    layouts.merged(draft.document, [local, { document: request.document, stale: false }])
    expect(layouts.stale(draft.document, draft.base)).toBe(false)

    expect(draft.undo()).toBe(true)
    expect(draft.document.gallery).toEqual([salonImage])
    expect(draft.document.settings['captured_layout']).toBeUndefined()
    expect(layouts.stale(draft.document, draft.base)).toBe(true)
    expect(draft.undo()).toBe(true)
    expect(draft.document.gallery).toEqual([])
    expect(layouts.stale(draft.document, draft.base)).toBe(false)
  })

  it('invalidates historical staff layouts when portrait-free membership is reconciled', () => {
    const old = emptyDocument()
    const current = emptyDocument()
    const person = {
      name: 'Former',
      ig: '',
      role_sv: '',
      role_en: '',
      bio_sv: '',
      bio_en: '',
      sort_order: 0,
    }
    old.barbers = [{ ...person, id: 'former' }]
    current.barbers = [{ ...person, id: 'current', name: 'Current' }]
    const restored = restoreRevision(old, current)
    expect(restored.reconciled).toBe(true)
    expect(restored.document.barbers).toEqual(current.barbers)
    expect(restored.document.photos).toEqual(old.photos)
    const layouts = new LayoutProvenance()
    layouts.captured(restored.document, old)
    expect(layouts.stale(restored.document, current)).toBe(true)
  })

  it('keeps layouts stale after a removal whose capture failed, back at the published data', () => {
    const layouts = new LayoutProvenance()
    const draft = new CmsDraft(emptyDocument(), 1, 'published')
    commit(draft, layouts, withGallery(draft.document, [salonImage]))
    capture(draft, layouts, 'with the salon image')
    expect(layouts.stale(draft.document, draft.base)).toBe(false)

    // The removal's capture fails: the layouts still show the image.
    commit(draft, layouts, withGallery(draft.document, []))
    expect(resourceLayoutsChanged(draft.base, draft.document)).toBe(false)
    expect(layouts.stale(draft.document, draft.base)).toBe(true)
  })

  it('keeps captured layouts through other edits, and undo brings each state back', () => {
    const layouts = new LayoutProvenance()
    const draft = new CmsDraft(emptyDocument(), 1, 'published')
    commit(draft, layouts, withGallery(draft.document, [salonImage]))
    expect(layouts.stale(draft.document, draft.base)).toBe(true)
    capture(draft, layouts, 'with the salon image')
    commit(draft, layouts, { ...draft.document, settings: { ...draft.document.settings, x: '1' } })
    expect(layouts.stale(draft.document, draft.base)).toBe(false)

    draft.undo()
    expect(layouts.stale(draft.document, draft.base)).toBe(false)
    // The capture completed the assignment's transaction, so undo goes back to the published data.
    draft.undo()
    expect(draft.document.gallery).toEqual([])
    expect(layouts.stale(draft.document, draft.base)).toBe(false)
    draft.redo()
    expect(layouts.stale(draft.document, draft.base)).toBe(false)
  })

  it('treats layouts of unknown origin as stale until they are captured', () => {
    const layouts = new LayoutProvenance()
    const draft = new CmsDraft(emptyDocument(), 1, 'published')
    const restored = structuredClone(draft.document)
    restored.settings['restored'] = '1'
    draft.change(restored)
    expect(layouts.stale(draft.document, draft.base)).toBe(false)
    layouts.unknown(draft.document)
    expect(layouts.stale(draft.document, draft.base)).toBe(true)
    capture(draft, layouts, 'fresh')
    expect(layouts.stale(draft.document, draft.base)).toBe(false)
  })

  it('trusts merged layouts only when every side was current with the merged resource data', () => {
    const base = emptyDocument()
    const local = withGallery(base, [salonImage])
    const remote = { ...base, settings: { ...base.settings, remote: '1' } }
    const merged = { ...local, settings: remote.settings }

    const current = new LayoutProvenance()
    current.merged(merged, [
      { document: local, stale: false },
      { document: structuredClone(merged), stale: false },
    ])
    expect(current.stale(merged, merged)).toBe(false)

    const otherData = new LayoutProvenance()
    otherData.merged(merged, [
      { document: local, stale: false },
      { document: remote, stale: false },
    ])
    expect(otherData.stale(merged, merged)).toBe(true)

    const staleSide = new LayoutProvenance()
    staleSide.merged(merged, [
      { document: local, stale: true },
      { document: structuredClone(merged), stale: false },
    ])
    expect(staleSide.stale(merged, merged)).toBe(true)
  })

  // Studio's 409 path: the merged document must be marked on the draft that holds it.
  it('tracks a merged draft by the clone the draft holds, never by the input', () => {
    const published = emptyDocument()
    const merged = withGallery(published, [])
    const layouts = new LayoutProvenance()
    const next = new CmsDraft(merged, 2, 'remote')
    expect(next.document).not.toBe(merged)
    layouts.unknown(merged)
    expect(layouts.stale(next.document, next.base)).toBe(false)
    layouts.unknown(next.document)
    expect(layouts.stale(next.document, next.base)).toBe(true)
  })

  it('gives a restored revision the layouts of its own resource data', () => {
    const old = withGallery(emptyDocument(), [salonImage])
    const reconciled = withGallery(old, [])
    const layouts = new LayoutProvenance()
    layouts.captured(reconciled, old)
    expect(layouts.stale(reconciled, reconciled)).toBe(true)
    const unchanged = structuredClone(old)
    layouts.captured(unchanged, old)
    expect(layouts.stale(unchanged, emptyDocument())).toBe(false)
  })
})
