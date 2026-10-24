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
  /** sessionStorage: the tab id, and the journal that carries the last write across a reload. */
  tabs: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
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
  /** For `pagehide`: flushes, and journals the unconfirmed write synchronously, because the page
   * may end before IndexedDB commits it. The next page in this tab replays the journal. */
  suspend(): Promise<void>
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
// The journal holds the document without its base (a production base would not fit beside it in
// WebKit's 5 MB sessionStorage); revision and fingerprint identify the base on replay.
const JOURNAL = 'knc-cms-journal'
const JOURNAL_DOCUMENT = 'knc-cms-journal-document'

interface Journal {
  tab: string
  savedAt: string
  /** A clean draft: the tab's record must go, so an older backup cannot come back. */
  removed?: true
  revision?: number
  fingerprint?: string
}
interface Write {
  draft: BackupDraft | null
  savedAt: string
}

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

/** A tab's record in its stored form, without parsing the other tabs' documents. */
async function storedRecord(records: BackupRecords, tab: string): Promise<StoredBackup | null> {
  const value = (await records.all()).find(
    (item) => Boolean(item) && typeof item === 'object' && (item as { tab?: unknown }).tab === tab,
  )
  return parseStored(value) ? (value as StoredBackup) : null
}

function parseJournal(json: string | null): Journal | null {
  try {
    const value: unknown = JSON.parse(json ?? 'null')
    if (!value || typeof value !== 'object') return null
    const journal = value as Partial<Journal>
    return typeof journal.tab === 'string' &&
      typeof journal.savedAt === 'string' &&
      (journal.revision === undefined || Number.isSafeInteger(journal.revision)) &&
      (journal.fingerprint === undefined || typeof journal.fingerprint === 'string')
      ? (journal as Journal)
      : null
  } catch {
    // A damaged journal stays untouched and is never replayed; the IndexedDB record remains.
    return null
  }
}

function forgetJournal(tabs: BackupPorts['tabs']): void {
  tabs.removeItem(JOURNAL)
  tabs.removeItem(JOURNAL_DOCUMENT)
}

/** Replays the journal the previous page of this tab left, unless IndexedDB already holds that
 * write or a newer one: a copy that a window.open'd tab inherits never beats newer data, and never
 * writes into a tab that is still open. The base is the stored record's when the record has the
 * same revision and fingerprint; otherwise the studio finds it as the server head, or resolves a
 * conflict with the journal's document as the owner's draft. */
async function replayJournal(ports: BackupPorts, tab: string): Promise<void> {
  const journal = parseJournal(ports.tabs.getItem(JOURNAL))
  if (!journal) return
  if (journal.tab !== tab && (await ports.locks.held()).has(lockName(journal.tab))) return
  const stored = await storedRecord(ports.records, journal.tab)
  if (!stored || stored.savedAt < journal.savedAt) {
    if (journal.removed) {
      if (stored) await ports.records.remove(journal.tab)
    } else {
      const document = ports.tabs.getItem(JOURNAL_DOCUMENT)
      const sameBase =
        stored?.base !== undefined &&
        stored.revision === journal.revision &&
        stored.fingerprint === journal.fingerprint
      const record: StoredBackup = {
        tab: journal.tab,
        savedAt: journal.savedAt,
        document: document ?? '',
        ...(journal.revision === undefined ? {} : { revision: journal.revision }),
        ...(journal.fingerprint === undefined ? {} : { fingerprint: journal.fingerprint }),
        ...(sameBase ? { base: stored.base } : {}),
      }
      // A journal without a readable document is damaged: keep it and the record untouched.
      if (document === null || !parseStored(record)) return
      await ports.records.put(record)
    }
  }
  forgetJournal(ports.tabs)
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
  await replayJournal(ports, tab)
  await migrateLegacy(ports)
  let pending: { draft: BackupDraft | null; report: (reason: unknown) => void } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  // Writes stay in call order, so an older draft never lands after a newer one.
  let writing: Promise<void> = Promise.resolve()
  // The newest write IndexedDB has not confirmed yet.
  let unconfirmed: Write | null = null

  const own = async (): Promise<TabBackup | null> =>
    (await readAll(ports.records)).find((record) => record.tab === tab) ?? null
  // A tab's savedAt only grows, even when the clock goes back, so the journal's newer-than check
  // orders this tab's writes like a sequence.
  let latest = (await own())?.savedAt ?? ''
  const stamp = (): string => {
    const now = ports.now()
    latest = now > latest ? now : new Date(Date.parse(latest) + 1).toISOString()
    return latest
  }
  const flush = (): Promise<void> => {
    clearTimeout(timer)
    const next = pending
    pending = null
    if (next) {
      const write: Write = { draft: next.draft, savedAt: stamp() }
      unconfirmed = write
      writing = writing
        .catch(() => undefined)
        .then(async () => {
          await (write.draft
            ? ports.records.put(toStored({ ...write.draft, savedAt: write.savedAt, tab }))
            : ports.records.remove(tab))
          if (unconfirmed !== write) return
          unconfirmed = null
          forgetJournal(ports.tabs)
        })
    }
    return writing
  }
  const journal = ({ draft, savedAt }: Write): void => {
    forgetJournal(ports.tabs)
    if (draft)
      try {
        ports.tabs.setItem(JOURNAL_DOCUMENT, serialize(draft.document))
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'QuotaExceededError')) throw reason
        // lazy dev: the document alone must fit in sessionStorage (WebKit: 5 MB, about 2.5 million
        // characters; the production draft has about 1.4 million). A larger one keeps only the
        // IndexedDB record, at most 500 ms old. Upgrade path: journal the edit as a delta against
        // that record instead of the whole document.
        return
      }
    const entry: Journal = draft
      ? {
          tab,
          savedAt,
          ...(draft.revision === undefined ? {} : { revision: draft.revision }),
          ...(draft.fingerprint === undefined ? {} : { fingerprint: draft.fingerprint }),
        }
      : { tab, savedAt, removed: true }
    ports.tabs.setItem(JOURNAL, JSON.stringify(entry))
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
    suspend: () => {
      const written = flush()
      if (unconfirmed) journal(unconfirmed)
      return written
    },
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
