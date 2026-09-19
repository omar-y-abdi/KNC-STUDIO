import type { CmsDocument, CmsSave } from '../../../shared/cms'

export class CmsDraft {
  document: CmsDocument
  base: CmsDocument
  revision: number
  fingerprint: string
  undoStack: CmsDocument[] = []
  redoStack: CmsDocument[] = []
  pending: CmsSave | null = null
  private lastGroup = ''
  private lastChange = 0

  constructor(document: CmsDocument, revision: number, fingerprint: string) {
    this.document = structuredClone(document)
    this.base = structuredClone(document)
    this.revision = revision
    this.fingerprint = fingerprint
  }

  get dirty(): boolean {
    return JSON.stringify(this.document) !== JSON.stringify(this.base)
  }

  change(next: CmsDocument, group = ''): void {
    if (JSON.stringify(next) === JSON.stringify(this.document)) return
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
    this.redoStack = []
    this.pending = null
    this.lastGroup = ''
  }

  beginSave(): CmsSave {
    return (this.pending ??= {
      document: structuredClone(this.document),
      baseRevision: this.revision,
      baseFingerprint: this.fingerprint,
      requestId: crypto.randomUUID(),
    })
  }

  acknowledge(document: CmsDocument, revision: number, fingerprint: string): void {
    const currentEqualsSaved = JSON.stringify(this.document) === JSON.stringify(document)
    this.base = structuredClone(document)
    if (currentEqualsSaved) this.document = structuredClone(document)
    this.revision = revision
    this.fingerprint = fingerprint
    this.pending = null
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
    return structuredClone(l)
  }
  return { document: merge(base, local, remote, '') as CmsDocument, conflicts }
}
