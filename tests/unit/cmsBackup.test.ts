import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDocument, type CmsDocument } from '../../shared/cms'
import {
  openBackupSession,
  type BackupPorts,
  type BackupSession,
  type TabBackup,
} from '../../src/admin/cms/backup'

const FINGERPRINT = '0123456789abcdef0123456789abcdef'

function named(name: string): CmsDocument {
  const document = emptyDocument()
  document.settings.business_name = name
  return document
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// IndexedDB, Web Locks, sessionStorage and localStorage as in-memory ports.
function memory(
  options: {
    records?: TabBackup[]
    held?: string[]
    tab?: string
    legacy?: Record<string, string>
  } = {},
) {
  const records = new Map((options.records ?? []).map((record) => [record.tab, record]))
  const held = new Set(options.held ?? [])
  const legacy = new Map(Object.entries(options.legacy ?? {}))
  const tabs = new Map(options.tab ? [['knc-cms-tab', options.tab]] : [])
  let ids = 0
  let clock = 0
  const ports: BackupPorts = {
    records: {
      all: async () => [...records.values()].map((record) => structuredClone(record)),
      put: vi.fn(async (record: TabBackup) => {
        records.set(record.tab, structuredClone(record))
      }),
      remove: vi.fn(async (tab: string) => {
        records.delete(tab)
      }),
    },
    locks: {
      claim: async (name) => {
        if (held.has(name)) return false
        held.add(name)
        return true
      },
      held: async () => new Set(held),
    },
    tabs: {
      getItem: (key) => tabs.get(key) ?? null,
      setItem: (key, value) => void tabs.set(key, value),
    },
    legacy: {
      get length() {
        return legacy.size
      },
      key: (index) => [...legacy.keys()][index] ?? null,
      getItem: (key) => legacy.get(key) ?? null,
      removeItem: (key) => void legacy.delete(key),
    },
    newId: () => `tab-${++ids}`,
    now: () => new Date(Date.UTC(2026, 9, 24, 12, 0, ++clock)).toISOString(),
  }
  return { ports, records, held, legacy, tabs }
}

const record = (tab: string, name: string, savedAt: string): TabBackup => ({
  tab,
  document: named(name),
  revision: 4,
  fingerprint: FINGERPRINT,
  base: emptyDocument(),
  savedAt,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CMS draft backup in IndexedDB', () => {
  it('round-trips a draft with the base the three-way merge needs', async () => {
    const { ports } = memory()
    const session = await openBackupSession(ports)
    const base = emptyDocument()
    session.schedule({ document: named('Lokal'), revision: 7, fingerprint: FINGERPRINT, base })
    await session.flush()
    expect(await session.own()).toEqual({
      document: named('Lokal'),
      revision: 7,
      fingerprint: FINGERPRINT,
      base,
      savedAt: '2026-10-24T12:00:01.000Z',
    })
    session.schedule(null)
    await session.flush()
    expect(await session.own()).toBeNull()
  })

  it('writes 500 ms after the last change and at once when flushed', async () => {
    vi.useFakeTimers()
    const { ports } = memory()
    const session = await openBackupSession(ports)
    session.schedule({ document: named('A'), revision: 1, fingerprint: FINGERPRINT })
    await vi.advanceTimersByTimeAsync(400)
    session.schedule({ document: named('AB'), revision: 1, fingerprint: FINGERPRINT })
    await vi.advanceTimersByTimeAsync(400)
    expect(ports.records.put).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(ports.records.put).toHaveBeenCalledTimes(1)
    expect((await session.own())?.document).toEqual(named('AB'))

    session.schedule({ document: named('ABC'), revision: 1, fingerprint: FINGERPRINT })
    await session.flush()
    expect((await session.own())?.document).toEqual(named('ABC'))
    expect(ports.records.put).toHaveBeenCalledTimes(2)
  })

  it('reports a failed debounced write to the tab that scheduled it', async () => {
    vi.useFakeTimers()
    const { ports } = memory()
    const session = await openBackupSession(ports)
    const failure = new DOMException('Quota exceeded', 'QuotaExceededError')
    vi.mocked(ports.records.put).mockRejectedValueOnce(failure)
    const report = vi.fn()
    session.schedule({ document: named('A'), revision: 1, fingerprint: FINGERPRINT }, report)
    await vi.advanceTimersByTimeAsync(500)
    expect(report).toHaveBeenCalledWith(failure)
  })

  it('offers every draft of a closed tab, newest first, and never one of an open tab', async () => {
    const { ports } = memory({
      tab: 'this-tab',
      held: ['knc-cms-tab:open-tab'],
      records: [
        record('closed-old', 'Gammal', '2026-10-20T08:00:00.000Z'),
        record('open-tab', 'Öppen', '2026-10-24T08:00:00.000Z'),
        record('closed-new', 'Ny', '2026-10-23T08:00:00.000Z'),
        record('this-tab', 'Egen', '2026-10-22T08:00:00.000Z'),
      ],
    })
    const session = await openBackupSession(ports)
    expect(session.tab).toBe('this-tab')
    expect((await session.offers()).map((offer) => offer.tab)).toEqual(['closed-new', 'closed-old'])
    expect((await session.own())?.document).toEqual(named('Egen'))
  })

  it('keeps both drafts of two closed tabs until the owner acts on each', async () => {
    const { ports, records } = memory({
      records: [
        record('first', 'Första', '2026-10-24T08:00:00.000Z'),
        record('second', 'Andra', '2026-10-24T09:00:00.000Z'),
      ],
    })
    const session: BackupSession = await openBackupSession(ports)
    session.schedule({ document: named('Ny flik'), revision: 4, fingerprint: FINGERPRINT })
    await session.flush()
    session.schedule(null)
    await session.flush()
    const reopened = await openBackupSession(memory({ records: [...records.values()] }).ports)
    expect((await reopened.offers()).map((offer) => offer.document)).toEqual([
      named('Andra'),
      named('Första'),
    ])
  })

  it('deletes exactly the draft the owner restored, exported or rejected', async () => {
    const { ports, records } = memory({
      tab: 'this-tab',
      records: [
        record('restore', 'Återställ', '2026-10-24T08:00:00.000Z'),
        record('export', 'Exportera', '2026-10-24T07:00:00.000Z'),
        record('reject', 'Kasta', '2026-10-24T06:00:00.000Z'),
      ],
    })
    const session = await openBackupSession(ports)
    const [restore, exported, rejected] = await session.offers()
    if (!restore || !exported || !rejected) throw new Error('Three offers were expected')

    await session.adopt(restore)
    expect([...records.keys()].sort()).toEqual(['export', 'reject', 'this-tab'])
    expect((await session.own())?.document).toEqual(named('Återställ'))

    await session.discard(exported)
    expect([...records.keys()].sort()).toEqual(['reject', 'this-tab'])
    await session.discard(rejected)
    expect([...records.keys()]).toEqual(['this-tab'])
  })

  it('keeps a closed tab draft when adopting it fails', async () => {
    const { ports, records } = memory({
      records: [record('closed', 'Stängd', '2026-10-24T08:00:00.000Z')],
    })
    const session = await openBackupSession(ports)
    const [offer] = await session.offers()
    if (!offer) throw new Error('An offer was expected')
    vi.mocked(ports.records.put).mockRejectedValueOnce(new Error('IndexedDB write failed'))
    await expect(session.adopt(offer)).rejects.toThrow('IndexedDB write failed')
    expect(records.has('closed')).toBe(true)
    expect(ports.records.remove).not.toHaveBeenCalled()
  })

  it('gives a duplicated tab a new identity while the original tab holds the lock', async () => {
    const { ports, tabs } = memory({ tab: 'original', held: ['knc-cms-tab:original'] })
    const session = await openBackupSession(ports)
    expect(session.tab).toBe('tab-1')
    expect(tabs.get('knc-cms-tab')).toBe('tab-1')
  })

  it('sets aside this tab draft so the tab never overwrites it', async () => {
    const { ports, records } = memory({
      tab: 'this-tab',
      records: [record('this-tab', 'Mall', '2026-10-24T08:00:00.000Z')],
    })
    const session = await openBackupSession(ports)
    await session.setAside()
    expect(await session.own()).toBeNull()
    expect((await session.offers()).map((offer) => [offer.tab, offer.document])).toEqual([
      ['tab-1', named('Mall')],
    ])
    expect(records.has('this-tab')).toBe(false)
  })
})

describe('migration from localStorage', () => {
  const legacy = {
    'knc-cms-draft:old-tab': JSON.stringify({
      document: named('Gammal flik'),
      revision: 3,
      fingerprint: FINGERPRINT,
      base: emptyDocument(),
      savedAt: '2026-10-01T08:00:00.000Z',
    }),
    // Written by the metadata-free version.
    'knc-cms-retained-template-draft': JSON.stringify({
      document: named('Mall'),
      savedAt: '2026-09-18T00:00:00.000Z',
    }),
    'knc-admin-auth': '{"user":{}}',
  }

  it('moves every legacy draft into IndexedDB and deletes the original only after the write', async () => {
    const { ports, legacy: storage } = memory({ legacy })
    const write = deferred()
    const put = vi.mocked(ports.records.put)
    const store = put.getMockImplementation()
    put.mockImplementation(async (value) => {
      await write.promise
      await store?.(value)
    })
    const opening = openBackupSession(ports)
    await vi.waitFor(() => expect(put).toHaveBeenCalled())
    expect(storage.has('knc-cms-draft:old-tab')).toBe(true)
    write.resolve()
    const session = await opening
    expect([...storage.keys()]).toEqual(['knc-admin-auth'])
    expect((await session.offers()).map((offer) => [offer.tab, offer.document])).toEqual([
      ['old-tab', named('Gammal flik')],
      ['retained-template', named('Mall')],
    ])
    const [migrated] = await session.offers()
    expect(migrated).toMatchObject({ revision: 3, fingerprint: FINGERPRINT, base: emptyDocument() })
  })

  it('keeps the localStorage original when the IndexedDB write fails', async () => {
    const { ports, legacy: storage } = memory({ legacy })
    vi.mocked(ports.records.put).mockRejectedValue(new Error('IndexedDB write failed'))
    await expect(openBackupSession(ports)).rejects.toThrow('IndexedDB write failed')
    expect([...storage.keys()].sort()).toEqual(Object.keys(legacy).sort())
  })

  it('recovers this tab draft after an upgrade reload, and ignores malformed metadata', async () => {
    const { ports, legacy: storage } = memory({
      tab: 'old-tab',
      legacy: {
        ...legacy,
        'knc-cms-draft:bad-revision': JSON.stringify({
          document: named('Fel'),
          savedAt: '2026-10-01T08:00:00.000Z',
          revision: '7',
        }),
      },
    })
    const session = await openBackupSession(ports)
    expect((await session.own())?.document).toEqual(named('Gammal flik'))
    expect(storage.has('knc-cms-draft:bad-revision')).toBe(true)
    expect((await session.offers()).map((offer) => offer.tab)).toEqual(['retained-template'])
  })

  it('never replaces a newer IndexedDB draft with an older localStorage copy', async () => {
    const newer = record('old-tab', 'Nyare', '2026-10-02T08:00:00.000Z')
    const { ports, legacy: storage } = memory({ legacy, records: [newer] })
    const session = await openBackupSession(ports)
    const offers = await session.offers()
    expect(offers.find((offer) => offer.tab === 'old-tab')?.document).toEqual(named('Nyare'))
    expect(storage.has('knc-cms-draft:old-tab')).toBe(false)
  })
})
