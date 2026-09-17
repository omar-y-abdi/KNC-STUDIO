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
  const entityIdentity = (path: string): ((value: unknown) => string) | null => {
    if (path === 'emails')
      return (value) => {
        const row = value as Record<string, unknown>
        return `${String(row['template'])}:${String(row['lang'])}`
      }
    if (path === 'barbers' || path === 'gallery' || path === 'presentation.pages')
      return (value) => String((value as Record<string, unknown>)['id'])
    return null
  }
  const completeOrder = (
    preferred: string[],
    secondary: string[],
    identities: string[],
  ): string[] => {
    const included = new Set(identities)
    const output = preferred.filter((identity) => included.has(identity))
    for (const identity of secondary) {
      if (!included.has(identity) || output.includes(identity)) continue
      const sourceIndex = secondary.indexOf(identity)
      let inserted = false
      for (let index = sourceIndex + 1; index < secondary.length; index++) {
        const anchor = secondary[index]
        if (!anchor) continue
        const target = output.indexOf(anchor)
        if (target >= 0) {
          output.splice(target, 0, identity)
          inserted = true
          break
        }
      }
      if (!inserted) {
        for (let index = sourceIndex - 1; index >= 0; index--) {
          const anchor = secondary[index]
          if (!anchor) continue
          const target = output.indexOf(anchor)
          if (target >= 0) {
            output.splice(target + 1, 0, identity)
            inserted = true
            break
          }
        }
      }
      if (!inserted) output.push(identity)
    }
    for (const identity of identities) if (!output.includes(identity)) output.push(identity)
    return output
  }
  const mergeOrder = (
    before: unknown[],
    ours: unknown[],
    theirs: unknown[],
    identities: string[],
    identify: (value: unknown) => string,
    path: string,
  ): string[] => {
    const included = new Set(identities)
    const orders = [before, ours, theirs].map((items) =>
      items.map(identify).filter((identity) => included.has(identity)),
    )
    const [baseOrder = [], localOrder = [], remoteOrder = []] = orders
    const positions = orders.map(
      (order) => new Map(order.map((identity, index) => [identity, index])),
    )
    const [basePositions, localPositions, remotePositions] = positions
    if (!basePositions || !localPositions || !remotePositions) return identities
    const relation = (positions: Map<string, number>, a: string, b: string): -1 | 0 | 1 => {
      const aIndex = positions.get(a),
        bIndex = positions.get(b)
      if (aIndex === undefined || bIndex === undefined) return 0
      return aIndex < bIndex ? -1 : 1
    }
    const edges = new Map(identities.map((identity) => [identity, new Set<string>()]))
    const indegree = new Map(identities.map((identity) => [identity, 0]))
    const addEdge = (first: string, second: string): void => {
      const targets = edges.get(first)
      if (!targets || targets.has(second)) return
      targets.add(second)
      indegree.set(second, (indegree.get(second) ?? 0) + 1)
    }
    const orderPath = `${path}.$order`
    const orderChoice = choices[orderPath]
    let directConflict = false
    for (let left = 0; left < identities.length; left++) {
      const a = identities[left]
      if (!a) continue
      for (let right = left + 1; right < identities.length; right++) {
        const b = identities[right]
        if (!b) continue
        const baseRelation = relation(basePositions, a, b),
          localRelation = relation(localPositions, a, b),
          remoteRelation = relation(remotePositions, a, b)
        let selected: -1 | 0 | 1 = 0
        if (localRelation !== 0 && localRelation === remoteRelation) selected = localRelation
        else if (baseRelation !== 0) {
          if (localRelation === 0) selected = remoteRelation || baseRelation
          else if (remoteRelation === 0) selected = localRelation || baseRelation
          else if (localRelation === baseRelation) selected = remoteRelation
          else if (remoteRelation === baseRelation) selected = localRelation
          else selected = localRelation
        } else if (localRelation === 0) selected = remoteRelation
        else if (remoteRelation === 0) selected = localRelation
        else if (localRelation === remoteRelation) selected = localRelation
        else if (orderChoice) selected = orderChoice === 'local' ? localRelation : remoteRelation
        else directConflict = true
        if (selected === -1) addEdge(a, b)
        else if (selected === 1) addEdge(b, a)
      }
    }
    const maximum = Number.MAX_SAFE_INTEGER
    const rank = (identity: string): number[] => [
      Math.min(
        localPositions.get(identity) ?? maximum,
        remotePositions.get(identity) ?? maximum,
        basePositions.get(identity) ?? maximum,
      ),
      basePositions.get(identity) ?? maximum,
      localPositions.get(identity) ?? maximum,
      remotePositions.get(identity) ?? maximum,
    ]
    const compareRank = (a: string, b: string): number => {
      const aRank = rank(a),
        bRank = rank(b)
      for (let index = 0; index < aRank.length; index++) {
        const difference = (aRank[index] ?? maximum) - (bRank[index] ?? maximum)
        if (difference !== 0) return difference
      }
      return a.localeCompare(b)
    }
    const available = identities
      .filter((identity) => (indegree.get(identity) ?? 0) === 0)
      .sort(compareRank)
    const output: string[] = []
    while (available.length > 0) {
      const identity = available.shift()
      if (!identity) break
      output.push(identity)
      for (const target of edges.get(identity) ?? []) {
        const remaining = (indegree.get(target) ?? 0) - 1
        indegree.set(target, remaining)
        if (remaining === 0) {
          available.push(target)
          available.sort(compareRank)
        }
      }
    }
    const cycle = output.length !== identities.length
    if (!directConflict && !cycle) return output
    if (!orderChoice)
      conflicts.push({
        path: orderPath,
        local: localOrder,
        remote: remoteOrder,
      })
    return completeOrder(
      orderChoice === 'remote' ? remoteOrder : localOrder,
      orderChoice === 'remote' ? localOrder : remoteOrder,
      identities,
    )
  }
  function mergeEntityArray(
    before: unknown[],
    ours: unknown[],
    theirs: unknown[],
    path: string,
    identify: (value: unknown) => string,
  ): unknown[] {
    const baseRows = new Map(before.map((value) => [identify(value), value])),
      localRows = new Map(ours.map((value) => [identify(value), value])),
      remoteRows = new Map(theirs.map((value) => [identify(value), value]))
    const identities = new Set([...baseRows.keys(), ...localRows.keys(), ...remoteRows.keys()])
    const merged = new Map<string, unknown>()
    for (const identity of identities) {
      const entityPath = `${path}.${identity}`
      const hasBase = baseRows.has(identity),
        hasLocal = localRows.has(identity),
        hasRemote = remoteRows.has(identity)
      const baseValue = baseRows.get(identity),
        localValue = localRows.get(identity),
        remoteValue = remoteRows.get(identity)
      if (!hasBase) {
        if (hasLocal && hasRemote)
          merged.set(identity, merge({}, localValue, remoteValue, entityPath))
        else if (hasLocal) merged.set(identity, structuredClone(localValue))
        else if (hasRemote) merged.set(identity, structuredClone(remoteValue))
        continue
      }
      if (!hasLocal && !hasRemote) continue
      if (!hasLocal || !hasRemote) {
        const surviving = hasLocal ? localValue : remoteValue
        if (same(baseValue, surviving)) continue
        const choice = choices[entityPath]
        if (!choice) {
          conflicts.push({
            path: entityPath,
            local: hasLocal ? localValue : null,
            remote: hasRemote ? remoteValue : null,
          })
          if (hasLocal) merged.set(identity, structuredClone(localValue))
          continue
        }
        const chosen = choice === 'local' ? localValue : remoteValue
        const chosenExists = choice === 'local' ? hasLocal : hasRemote
        if (chosenExists) merged.set(identity, structuredClone(chosen))
        continue
      }
      merged.set(identity, merge(baseValue, localValue, remoteValue, entityPath))
    }
    const mergedIdentities = [...merged.keys()]
    const ordered =
      path === 'presentation.pages'
        ? mergeOrder(before, ours, theirs, mergedIdentities, identify, path)
        : mergedIdentities.sort((a, b) => a.localeCompare(b))
    return ordered.map((identity) => structuredClone(merged.get(identity)))
  }
  function merge(before: unknown, ours: unknown, theirs: unknown, path: string): unknown {
    if (same(ours, theirs) || same(before, theirs)) return structuredClone(ours)
    if (same(before, ours)) return structuredClone(theirs)
    if (choices[path]) return structuredClone(choices[path] === 'local' ? ours : theirs)
    if (Array.isArray(before) && Array.isArray(ours) && Array.isArray(theirs)) {
      const identify = entityIdentity(path)
      if (identify) return mergeEntityArray(before, ours, theirs, path, identify)
    }
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
