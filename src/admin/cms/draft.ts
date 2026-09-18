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
