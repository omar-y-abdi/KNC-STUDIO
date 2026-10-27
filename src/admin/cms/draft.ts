import type { CmsBarber, CmsDocument, CmsSave } from '../../../shared/cms'

// Draft transactions replace snapshots instead of mutating them, so a snapshot's JSON is fixed
// by its identity. A production document serializes to over a million characters.
const serialized = new WeakMap<CmsDocument, string>()

export function serialize(document: CmsDocument): string {
  let json = serialized.get(document)
  if (json === undefined) {
    json = JSON.stringify(document)
    serialized.set(document, json)
  }
  return json
}

export class CmsDraft {
  document: CmsDocument
  base: CmsDocument
  revision: number
  fingerprint: string
  undoStack: CmsDocument[] = []
  redoStack: CmsDocument[] = []
  pending: CmsSave | null = null
  private submitted: CmsDocument | null = null
  private lastGroup = ''
  private lastChange = 0
  private dirtyComparison: { document: CmsDocument; base: CmsDocument; dirty: boolean } | null =
    null
  private editingBase: CmsDocument
  private editingBaseSource: CmsDocument
  private editComparison: { document: CmsDocument; base: CmsDocument; edited: boolean } | null =
    null

  constructor(
    document: CmsDocument,
    revision: number,
    fingerprint: string,
    base: CmsDocument = document,
  ) {
    this.document = structuredClone(document)
    this.base = structuredClone(base)
    // The editable server snapshot can include automatic migrations which are not yet published.
    this.editingBase = this.document
    this.editingBaseSource = this.base
    this.revision = revision
    this.fingerprint = fingerprint
  }

  get dirty(): boolean {
    // Draft transactions replace snapshots; selection, zoom and panel renders do not.
    // Include base identity because refresh/conflict resolution may replace it directly.
    if (
      this.dirtyComparison?.document !== this.document ||
      this.dirtyComparison.base !== this.base
    ) {
      this.dirtyComparison = {
        document: this.document,
        base: this.base,
        dirty: serialize(this.document) !== serialize(this.base),
      }
    }
    return this.dirtyComparison.dirty
  }

  /** The server snapshot with automatic migrations, never edits from this tab or a backup. */
  get uneditedDocument(): CmsDocument {
    return this.editingBaseSource === this.base ? this.editingBase : this.base
  }

  /** Author changes which adopting another draft would replace; migrations alone stay dirty
   * for publication but do not prevent recovery. A replaced base is conservative until migrated. */
  get hasEdits(): boolean {
    const base = this.uneditedDocument
    if (this.editComparison?.document !== this.document || this.editComparison.base !== base)
      this.editComparison = {
        document: this.document,
        base,
        edited: serialize(this.document) !== serialize(base),
      }
    return this.editComparison.edited
  }

  change(next: CmsDocument, group = ''): void {
    if (serialize(next) === serialize(this.document)) return
    const now = Date.now()
    if (!group || group !== this.lastGroup || now - this.lastChange > 800) {
      this.undoStack.push(this.document)
      if (this.undoStack.length > 50) this.undoStack.shift()
    }
    this.document = next
    this.redoStack = []
    this.lastGroup = group
    this.lastChange = now
    this.pending = null
  }

  /** Completes the current transaction in place, without an undo step of its own. */
  amend(next: CmsDocument): void {
    this.document = next
    this.pending = null
  }

  /** A migration is not an edit: it rewrites the current document and every undo/redo snapshot
   * without a history entry, so no undo returns to an unmigrated document. The base stays the
   * authoritative server document. `adopted` hears each replaced snapshot. */
  migrate(
    update: (document: CmsDocument) => CmsDocument,
    adopted: (previous: CmsDocument, next: CmsDocument) => void,
  ): void {
    // Migrate the unedited server snapshot independently, never copy a possibly edited document.
    this.editingBase = update(this.uneditedDocument)
    this.editingBaseSource = this.base
    const apply = (document: CmsDocument): CmsDocument => {
      const next = update(document)
      if (serialize(next) === serialize(document)) return document
      adopted(document, next)
      return next
    }
    this.undoStack = this.undoStack.map(apply)
    this.redoStack = this.redoStack.map(apply)
    const next = apply(this.document)
    if (next === this.document) return
    this.document = next
    this.pending = null
  }

  undo(): boolean {
    const previous = this.undoStack.pop()
    if (!previous) return false
    this.redoStack.push(this.document)
    this.document = previous
    this.lastGroup = ''
    this.pending = null
    return true
  }

  redo(): boolean {
    const next = this.redoStack.pop()
    if (!next) return false
    this.undoStack.push(this.document)
    this.document = next
    this.lastGroup = ''
    this.pending = null
    return true
  }

  revert(): void {
    if (!this.dirty) return
    this.undoStack.push(this.document)
    this.document = structuredClone(this.base)
    this.editingBase = this.base
    this.editingBaseSource = this.base
    this.redoStack = []
    this.pending = null
    this.lastGroup = ''
  }

  beginSave(): CmsSave {
    const request = (this.pending ??= {
      document: structuredClone(this.document),
      baseRevision: this.revision,
      baseFingerprint: this.fingerprint,
      requestId: crypto.randomUUID(),
    })
    // Editing invalidates a retry, not the snapshot of the request still in flight.
    this.submitted = request.document
    return request
  }

  acknowledge(document: CmsDocument, revision: number, fingerprint: string): void {
    this.document = mergeCmsDocuments(this.submitted ?? document, this.document, document).document
    this.base = structuredClone(document)
    this.editingBase = this.base
    this.editingBaseSource = this.base
    this.revision = revision
    this.fingerprint = fingerprint
    this.pending = null
    this.submitted = null
    this.lastGroup = ''
  }
}

export interface CmsMergeConflict {
  path: string
}
export interface CmsMergeResult {
  document: CmsDocument
  conflicts: CmsMergeConflict[]
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function mergeCmsDocuments(
  base: CmsDocument,
  local: CmsDocument,
  remote: CmsDocument,
  resolution: 'local' | 'remote' = 'local',
): CmsMergeResult {
  const conflicts: CmsMergeConflict[] = []
  const merge = (a: unknown, l: unknown, r: unknown, path: string): unknown => {
    if (same(l, r)) return structuredClone(l)
    if (same(l, a)) return structuredClone(r)
    if (same(r, a)) return structuredClone(l)
    if (
      a &&
      l &&
      r &&
      typeof a === 'object' &&
      typeof l === 'object' &&
      typeof r === 'object' &&
      !Array.isArray(a) &&
      !Array.isArray(l) &&
      !Array.isArray(r)
    ) {
      const out: Record<string, unknown> = {}
      const keys = new Set([
        ...Object.keys(a as Record<string, unknown>),
        ...Object.keys(l as Record<string, unknown>),
        ...Object.keys(r as Record<string, unknown>),
      ])
      for (const key of keys)
        out[key] = merge(
          (a as Record<string, unknown>)[key],
          (l as Record<string, unknown>)[key],
          (r as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        )
      return out
    }
    conflicts.push({ path })
    return structuredClone(resolution === 'remote' ? r : l)
  }
  return { document: merge(base, local, remote, '') as CmsDocument, conflicts }
}

export interface RevisionRestore {
  document: CmsDocument
  /** The revision's staff differed from the current roster and was matched to it. */
  reconciled: boolean
}

const rosterIds = (barbers: CmsBarber[]): string =>
  barbers
    .map((barber) => barber.id)
    .sort()
    .join('\n')

/** A published revision as a draft the database accepts: it publishes only the current roster.
 * Barbers and photos keep the revision's content for ids that still exist, the current entry
 * for barbers added since, and drop barbers who have left. */
export function restoreRevision(
  revision: CmsDocument,
  current: Pick<CmsDocument, 'barbers' | 'photos'>,
): RevisionRestore {
  if (rosterIds(revision.barbers) === rosterIds(current.barbers))
    return { document: revision, reconciled: false }
  const restored = new Map(revision.barbers.map((barber) => [barber.id, barber]))
  const photos: Record<string, string> = {}
  for (const { id } of current.barbers) {
    const path = revision.photos[id] ?? current.photos[id]
    if (path !== undefined) photos[id] = path
  }
  return {
    document: {
      ...revision,
      barbers: current.barbers.map((barber) => restored.get(barber.id) ?? barber),
      photos,
    },
    reconciled: true,
  }
}
