import {
  validateDocument,
  type CmsDocument,
  type CmsState,
  type CmsSave,
  type CmsPublication,
} from '../../../shared/cms'

export function canonicalDocument(value: CmsDocument): CmsDocument {
  const document = structuredClone(value)
  document.barbers.sort((a, b) => a.id.localeCompare(b.id))
  document.gallery.sort((a, b) => a.id.localeCompare(b.id))
  document.emails.sort((a, b) => `${a.template}:${a.lang}`.localeCompare(`${b.template}:${b.lang}`))
  return document
}
export function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const row = value as Record<string, unknown>
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(row[key])}`)
    .join(',')}}`
}
export interface DraftBackup {
  schema: 1
  userId: string
  savedAt: string
  baseRevision: number
  baseFingerprint: string
  base: CmsDocument
  document: CmsDocument
  pending: CmsSave | null
}
export class CmsDraft {
  document: CmsDocument
  base: CmsDocument
  revision: number
  fingerprint: string
  pending: CmsSave | null = null
  private undoStack: CmsDocument[] = []
  private redoStack: CmsDocument[] = []
  private lastGroup = ''
  private lastChange = 0
  constructor(state: CmsState) {
    this.document = canonicalDocument(state.document)
    this.base = canonicalDocument(state.document)
    this.revision = state.revision
    this.fingerprint = state.fingerprint
  }
  get dirty(): boolean {
    return stable(this.document) !== stable(this.base)
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
  change(operation: (document: CmsDocument) => void, group = '', now = Date.now()): boolean {
    const next = structuredClone(this.document)
    operation(next)
    return this.replace(next, group, now)
  }
  replace(value: CmsDocument, group = '', now = Date.now()): boolean {
    validateDocument(value)
    const next = canonicalDocument(value)
    if (stable(next) === stable(this.document)) return false
    if (!group || group !== this.lastGroup || now - this.lastChange > 600) {
      this.undoStack.push(this.document)
      while (
        this.undoStack.length > 40 ||
        (this.undoStack.length > 1 && stable(this.undoStack).length > 16 * 1024 * 1024)
      )
        this.undoStack.shift()
    }
    this.document = next
    this.redoStack = []
    this.lastGroup = group
    this.lastChange = now
    return true
  }
  undo(): void {
    const previous = this.undoStack.pop()
    if (!previous) return
    this.redoStack.push(this.document)
    this.document = previous
    this.lastGroup = ''
  }
  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.document)
    this.document = next
    this.lastGroup = ''
  }
  revert(): void {
    if (this.pending) throw new Error('Bekräfta det pågående sparförsöket innan utkastet kastas.')
    this.replace(this.base)
  }
  request(id: () => string = () => crypto.randomUUID()): CmsSave {
    this.pending ??= {
      document: structuredClone(this.document),
      baseRevision: this.revision,
      baseFingerprint: this.fingerprint,
      requestId: id(),
    }
    return structuredClone(this.pending)
  }
  acknowledge(result: CmsPublication): void {
    if (!this.pending || result.requestId !== this.pending.requestId)
      throw new Error('Publiceringssvaret matchar inte sparförsöket.')
    const sent = canonicalDocument(this.pending.document),
      published = canonicalDocument(result.document)
    if (stable(this.document) === stable(sent)) this.document = structuredClone(published)
    this.base = published
    this.revision = result.revision
    this.fingerprint = result.fingerprint
    this.pending = null
    this.lastGroup = ''
  }
  rejected(definitive: boolean): void {
    if (definitive) this.pending = null
  }
  rebase(remote: CmsState, merged: CmsDocument): void {
    if (this.pending) throw new Error('Ett obekräftat sparförsök måste först klarläggas.')
    this.replace(merged)
    this.base = canonicalDocument(remote.document)
    this.revision = remote.revision
    this.fingerprint = remote.fingerprint
  }
  backup(userId: string): DraftBackup {
    return {
      schema: 1,
      userId,
      savedAt: new Date().toISOString(),
      baseRevision: this.revision,
      baseFingerprint: this.fingerprint,
      base: structuredClone(this.base),
      document: structuredClone(this.document),
      pending: this.pending ? structuredClone(this.pending) : null,
    }
  }
  restore(backup: DraftBackup): void {
    this.replace(backup.document)
    this.base = canonicalDocument(backup.base)
    this.revision = backup.baseRevision
    this.fingerprint = backup.baseFingerprint
    this.pending = backup.pending ? structuredClone(backup.pending) : null
  }
}
export function parseBackup(raw: string, userId: string): DraftBackup {
  if (raw.length > 8 * 1024 * 1024) throw new Error('Reservutkastet är för stort.')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Reservutkastet kunde inte läsas.')
  const row = value as Record<string, unknown>
  if (
    row['schema'] !== 1 ||
    row['userId'] !== userId ||
    typeof row['savedAt'] !== 'string' ||
    typeof row['baseRevision'] !== 'number' ||
    !Number.isSafeInteger(row['baseRevision']) ||
    row['baseRevision'] < 0 ||
    typeof row['baseFingerprint'] !== 'string' ||
    !/^[0-9a-f]{32}$/.test(row['baseFingerprint'])
  )
    throw new Error('Reservutkastet tillhör inte denna användare eller version.')
  validateDocument(row['base'])
  validateDocument(row['document'])
  if (row['pending'] !== null) {
    if (!row['pending'] || typeof row['pending'] !== 'object' || Array.isArray(row['pending']))
      throw new Error('Ogiltigt sparförsök i reservutkastet.')
    const pending = row['pending'] as Record<string, unknown>
    validateDocument(pending['document'])
    if (
      pending['baseRevision'] !== row['baseRevision'] ||
      pending['baseFingerprint'] !== row['baseFingerprint'] ||
      typeof pending['requestId'] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pending['requestId'])
    )
      throw new Error('Ogiltigt sparförsök i reservutkastet.')
  }
  return row as unknown as DraftBackup
}
export interface MergeConflict {
  path: string
  local: unknown
  remote: unknown
}
export function mergeDocuments(
  base: CmsDocument,
  local: CmsDocument,
  remote: CmsDocument,
  choices: Record<string, 'local' | 'remote'> = {},
): { document: CmsDocument; conflicts: MergeConflict[] } {
  const conflicts: MergeConflict[] = []
  const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b)
  const merge = (before: unknown, ours: unknown, theirs: unknown, path: string): unknown => {
    if (same(ours, theirs) || same(before, theirs)) return structuredClone(ours)
    if (same(before, ours)) return structuredClone(theirs)
    if (choices[path]) return structuredClone(choices[path] === 'local' ? ours : theirs)
    if (
      before &&
      ours &&
      theirs &&
      !Array.isArray(before) &&
      !Array.isArray(ours) &&
      !Array.isArray(theirs) &&
      typeof before === 'object' &&
      typeof ours === 'object' &&
      typeof theirs === 'object'
    ) {
      const b = before as Record<string, unknown>,
        l = ours as Record<string, unknown>,
        r = theirs as Record<string, unknown>
      const output: Record<string, unknown> = {}
      for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
        const value = merge(b[key], l[key], r[key], path ? `${path}.${key}` : key)
        if (value !== undefined) output[key] = value
      }
      return output
    }
    conflicts.push({ path, local: ours, remote: theirs })
    return structuredClone(ours)
  }
  const document = merge(
    canonicalDocument(base),
    canonicalDocument(local),
    canonicalDocument(remote),
    '',
  ) as CmsDocument
  validateDocument(document)
  return { document, conflicts }
}
