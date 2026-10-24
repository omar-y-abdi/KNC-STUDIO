import { describe, expect, it } from 'vitest'
import { emptyDocument, type CmsDocument } from '../../shared/cms'
import { resourceLayoutsChanged } from '../../src/admin/cms/captureResourceLayouts'
import { CmsDraft } from '../../src/admin/cms/draft'
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
  layouts.follow(previous, draft.document)
}

describe('Home/About layout provenance', () => {
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
