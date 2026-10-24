import type { CmsDocument } from '../../../shared/cms'
import { serialize } from './draft'
import { openKeyedStore } from './indexedDb'

export interface CmsBackup {
  document: CmsDocument
  savedAt: string
  // Keep backups written by the metadata-free version recoverable.
  revision?: number
  fingerprint?: string
  base?: CmsDocument
}
/** A draft kept for the browser tab that wrote it. */
export interface TabBackup extends CmsBackup {
  tab: string
}
export type BackupDraft = Omit<CmsBackup, 'savedAt'>
/** The stored form keeps JSON text: IndexedDB then copies two strings instead of walking two
 * production-size documents, and the draft's text is usually serialized already. */
export interface StoredBackup extends Omit<TabBackup, 'document' | 'base'> {
  document: string
  base?: string
}

/** IndexedDB in the browser: one record per tab, keyed by `tab`. */
export interface BackupRecords {
  all(): Promise<unknown[]>
  put(record: StoredBackup): Promise<void>
  remove(tab: string): Promise<void>
}
/** Web Locks: an open tab holds the lock named after its id until the tab is closed. */
export interface TabLocks {
  claim(name: string): Promise<boolean>
  held(): Promise<ReadonlySet<string>>
}
export interface BackupPorts {
  records: BackupRecords
  locks: TabLocks
  tabs: Pick<Storage, 'getItem' | 'setItem'>
  legacy: Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>
  newId: () => string
  now: () => string
}

export interface BackupSession {
  readonly tab: string
  /** This tab's draft, e.g. from before a reload. */
  own(): Promise<CmsBackup | null>
  /** Drafts of closed tabs, newest first. Each stays until the owner acts on it. */
  offers(): Promise<TabBackup[]>
  /** Writes this tab's draft (null removes it) 500 ms after the last call. */
  schedule(draft: BackupDraft | null, report?: (reason: unknown) => void): void
  /** Writes the scheduled draft now. */
  flush(): Promise<void>
  /** Makes a closed tab's draft this tab's own, then deletes the closed tab's copy. */
  adopt(offer: TabBackup): Promise<void>
  /** Deletes exactly this draft, after the owner exported or rejected it. */
  discard(offer: TabBackup): Promise<void>
  /** Keeps this tab's draft under a new id, so the tab never overwrites it. */
  setAside(): Promise<void>
}

const TAB_KEY = 'knc-cms-tab'
const LEGACY_DRAFT = /^knc-cms-draft:(.+)$/
const LEGACY_TEMPLATE = 'knc-cms-retained-template-draft'
const lockName = (tab: string): string => `knc-cms-tab:${tab}`

function isBackup(value: unknown): value is CmsBackup {
  if (!value || typeof value !== 'object') return false
  const backup = value as Partial<CmsBackup>
  return (
    Boolean(backup.document) &&
    typeof backup.savedAt === 'string' &&
    (backup.revision === undefined || Number.isSafeInteger(backup.revision)) &&
    (backup.fingerprint === undefined || typeof backup.fingerprint === 'string')
  )
}
const toStored = ({ document, base, ...metadata }: TabBackup): StoredBackup => ({
  ...metadata,
  document: serialize(document),
  ...(base ? { base: serialize(base) } : {}),
})

function parseStored(value: unknown): TabBackup | null {
  if (!value || typeof value !== 'object') return null
  const { document, base, ...metadata } = value as Partial<StoredBackup>
  if (typeof document !== 'string' || typeof metadata.tab !== 'string') return null
  if (base !== undefined && typeof base !== 'string') return null
  try {
    const backup = {
      ...metadata,
      document: JSON.parse(document) as CmsDocument,
      ...(base === undefined ? {} : { base: JSON.parse(base) as CmsDocument }),
    }
    return isBackup(backup) ? { ...backup, tab: metadata.tab } : null
  } catch {
    // A damaged record is never offered and never deleted automatically.
    return null
  }
}

function parseLegacy(json: string | null): CmsBackup | null {
  try {
    const value: unknown = JSON.parse(json ?? 'null')
    return isBackup(value) ? value : null
  } catch {
    // An unreadable copy stays in localStorage untouched; there is nothing to migrate.
    return null
  }
}

async function readAll(records: BackupRecords): Promise<TabBackup[]> {
  return (await records.all()).flatMap((value) => parseStored(value) ?? [])
}

/** Copies every localStorage draft into IndexedDB; deletes an original only after its write. */
async function migrateLegacy(ports: BackupPorts): Promise<void> {
  const stored = new Map((await readAll(ports.records)).map((record) => [record.tab, record]))
  const keys = Array.from({ length: ports.legacy.length }, (_, index) => ports.legacy.key(index))
  for (const key of keys) {
    const tab = key === LEGACY_TEMPLATE ? 'retained-template' : LEGACY_DRAFT.exec(key ?? '')?.[1]
    const backup = key && tab ? parseLegacy(ports.legacy.getItem(key)) : null
    if (!key || !tab || !backup) continue
    const current = stored.get(tab)
    if (!current || current.savedAt < backup.savedAt)
      await ports.records.put(toStored({ ...backup, tab }))
    ports.legacy.removeItem(key)
  }
}

/** A duplicated tab copies sessionStorage; the original's lock tells the copy to pick a new id. */
async function claimTab(ports: BackupPorts): Promise<string> {
  let tab = ports.tabs.getItem(TAB_KEY) ?? ports.newId()
  while (!(await ports.locks.claim(lockName(tab)))) tab = ports.newId()
  ports.tabs.setItem(TAB_KEY, tab)
  return tab
}

export async function openBackupSession(ports: BackupPorts): Promise<BackupSession> {
  const tab = await claimTab(ports)
  await migrateLegacy(ports)
  let pending: { draft: BackupDraft | null; report: (reason: unknown) => void } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  // Writes stay in call order, so an older draft never lands after a newer one.
  let writing: Promise<void> = Promise.resolve()

  const own = async (): Promise<TabBackup | null> =>
    (await readAll(ports.records)).find((record) => record.tab === tab) ?? null
  const flush = (): Promise<void> => {
    clearTimeout(timer)
    const next = pending
    pending = null
    if (next)
      writing = writing
        .catch(() => undefined)
        .then(() =>
          next.draft
            ? ports.records.put(toStored({ ...next.draft, savedAt: ports.now(), tab }))
            : ports.records.remove(tab),
        )
    return writing
  }
  const move = async (record: TabBackup, to: string): Promise<void> => {
    await ports.records.put(toStored({ ...record, tab: to }))
    await ports.records.remove(record.tab)
  }
  return {
    tab,
    own: async () => {
      const record = await own()
      if (!record) return null
      const backup: CmsBackup & { tab?: string } = { ...record }
      Reflect.deleteProperty(backup, 'tab')
      return backup
    },
    offers: async () => {
      const [records, held] = await Promise.all([readAll(ports.records), ports.locks.held()])
      return records
        .filter((record) => record.tab !== tab && !held.has(lockName(record.tab)))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    },
    schedule: (draft, report = () => undefined) => {
      pending = { draft, report }
      clearTimeout(timer)
      timer = setTimeout(() => void flush().catch(report), 500)
    },
    flush,
    adopt: async (offer) => {
      await flush()
      await move(offer, tab)
    },
    discard: (offer) => ports.records.remove(offer.tab),
    setAside: async () => {
      await flush()
      const record = await own()
      if (record) await move(record, ports.newId())
    },
  }
}

const browserLocks: TabLocks = {
  claim: (name) =>
    new Promise((resolve, reject) => {
      navigator.locks
        .request(name, { ifAvailable: true }, (lock) => {
          resolve(lock !== null)
          // Held until the page is destroyed; the browser then releases the lock.
          return lock ? new Promise<never>(() => undefined) : undefined
        })
        .catch(reject)
    }),
  held: async () =>
    new Set(((await navigator.locks.query()).held ?? []).flatMap((lock) => lock.name ?? [])),
}

let session: Promise<BackupSession> | undefined

/** The page's backup session: one tab identity and lock for the page's lifetime. */
export function cmsBackups(): Promise<BackupSession> {
  session ??= openKeyedStore('knc-cms-drafts', 'tab')
    .then((records) =>
      openBackupSession({
        records,
        locks: browserLocks,
        tabs: sessionStorage,
        legacy: localStorage,
        newId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      }),
    )
    .catch((reason: unknown) => {
      session = undefined
      throw reason
    })
  return session
}
