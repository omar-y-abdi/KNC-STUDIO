import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDocument, type CmsDocument } from '../../shared/cms'
import {
  JournalFull,
  openBackupSession,
  type BackupPorts,
  type BackupSession,
  type StoredBackup,
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
    records?: StoredBackup[]
    held?: string[]
    tab?: string
    legacy?: Record<string, string>
  } = {},
) {
  const records = new Map((options.records ?? []).map((record) => [record.tab, record]))
  const held = new Set(options.held ?? [])
  const legacy = new Map(Object.entries(options.legacy ?? {}))
  const tabs = new Map(options.tab ? [['knc-cms-tab', options.tab]] : [])
  return { ports: pagePorts(records, held, legacy, tabs), records, held, legacy, tabs }
}

// One page's ports over the browser state; a reload is a new page over the same maps.
function pagePorts(
  records: Map<string, StoredBackup>,
  held: Set<string>,
  legacy: Map<string, string>,
  tabs: Map<string, string>,
  start = 0,
): BackupPorts {
  let ids = 0
  let clock = start
  return {
    records: {
      all: async () => [...records.values()].map((record) => structuredClone(record)),
      put: vi.fn(async (record: StoredBackup) => {
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
      hold: async (name, work) => {
        if (held.has(name)) return false
        held.add(name)
        try {
          await work()
        } finally {
          held.delete(name)
        }
        return true
      },
    },
    tabs: {
      getItem: (key) => tabs.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => void tabs.set(key, value)),
      removeItem: (key) => void tabs.delete(key),
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
}

const record = (tab: string, name: string, savedAt: string): StoredBackup => ({
  tab,
  document: JSON.stringify(named(name)),
  revision: 4,
  fingerprint: FINGERPRINT,
  base: JSON.stringify(emptyDocument()),
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

    expect(await session.adopt(restore)).toBe('done')
    expect([...records.keys()].sort()).toEqual(['export', 'reject', 'this-tab'])
    expect((await session.own())?.document).toEqual(named('Återställ'))

    expect(await session.discard(exported)).toBe('done')
    expect([...records.keys()].sort()).toEqual(['reject', 'this-tab'])
    expect(await session.discard(rejected)).toBe('done')
    expect([...records.keys()]).toEqual(['this-tab'])
  })

  // Another tab listed the offer, then its own tab reloaded (reclaiming the lock) or wrote again.
  // Exportera downloads the listed draft first, so a stale offer must not delete a newer one.
  it.each(['adopt', 'discard'] as const)(
    'never lets a stale offer %s the newer draft of a reopened tab',
    async (action) => {
      const { ports, records, held } = memory({
        tab: 'this-tab',
        records: [record('closed', 'Listad', '2026-10-24T08:00:00.000Z')],
      })
      const session = await openBackupSession(ports)
      const [offer] = await session.offers()
      if (!offer) throw new Error('An offer was expected')
      const act = () => (action === 'adopt' ? session.adopt(offer) : session.discard(offer))

      // The tab reopened and holds its lock again.
      held.add('knc-cms-tab:closed')
      expect(await act()).toBe('stale')
      expect(records.get('closed')?.document).toBe(JSON.stringify(named('Listad')))
      held.delete('knc-cms-tab:closed')

      // The tab wrote a newer draft and closed again.
      records.set('closed', record('closed', 'Nyare', '2026-10-24T09:00:00.000Z'))
      expect(await act()).toBe('stale')
      expect(records.get('closed')?.document).toBe(JSON.stringify(named('Nyare')))
      expect(records.has('this-tab')).toBe(false)
      expect(await session.offers()).toMatchObject([{ tab: 'closed', document: named('Nyare') }])

      // Another tab already took it.
      records.delete('closed')
      expect(await act()).toBe('stale')
      expect(records.has('this-tab')).toBe(false)
    },
  )

  it('releases the closed tab lock after acting on its offer', async () => {
    const { ports, held } = memory({
      tab: 'this-tab',
      records: [record('closed', 'Stängd', '2026-10-24T08:00:00.000Z')],
    })
    const session = await openBackupSession(ports)
    const [offer] = await session.offers()
    if (!offer) throw new Error('An offer was expected')
    expect(await session.discard(offer)).toBe('done')
    expect(held.has('knc-cms-tab:closed')).toBe(false)
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

  it('keeps the stale-layouts mark of a draft', async () => {
    const { ports } = memory()
    const session = await openBackupSession(ports)
    session.schedule({
      document: named('Lokal'),
      revision: 7,
      fingerprint: FINGERPRINT,
      layoutsStale: true,
    })
    await session.flush()
    expect(await session.own()).toMatchObject({ layoutsStale: true })
  })

  it('reports a draft too large for the reload journal, and still writes it', async () => {
    const { ports } = memory()
    const session = await openBackupSession(ports)
    const large = named('x'.repeat(2_000_000))
    const report = vi.fn()
    session.schedule({ document: large, revision: 1, fingerprint: FINGERPRINT }, report)
    await session.flush()
    expect(report).toHaveBeenCalledWith(expect.any(JournalFull))
    expect((await session.own())?.document).toEqual(large)

    report.mockClear()
    session.schedule({ document: named('Liten'), revision: 1, fingerprint: FINGERPRINT }, report)
    await session.flush()
    expect(report).not.toHaveBeenCalled()
  })
})

// The page ends before IndexedDB answers, so its writes never confirm.
function unload(ports: BackupPorts): void {
  vi.mocked(ports.records.put).mockImplementation(() => new Promise(() => undefined))
  vi.mocked(ports.records.remove).mockImplementation(() => new Promise(() => undefined))
}
// The next page in the same tab: the old page's lock is released, sessionStorage stays.
const reload = (browser: ReturnType<typeof memory>): BackupPorts =>
  pagePorts(browser.records, new Set(), browser.legacy, browser.tabs, 100)
const JOURNAL = 'knc-cms-journal'
// The journal's metadata line, before the document.
const journalMeta = (tabs: Map<string, string>): unknown =>
  JSON.parse((tabs.get(JOURNAL) ?? '').split('\n')[0] ?? '')

describe('sessionStorage journal across a reload', () => {
  it('replays an unconfirmed write, with the stored base while its revision matches', async () => {
    const browser = memory({
      tab: 'this-tab',
      records: [record('this-tab', 'Sparad', '2026-10-24T08:00:00.000Z')],
    })
    const session = await openBackupSession(browser.ports)
    unload(browser.ports)
    session.schedule({
      document: named('Osparad'),
      revision: 4,
      fingerprint: FINGERPRINT,
      base: emptyDocument(),
    })
    void session.suspend()
    // The journal holds the document and the base's identity, never the base itself.
    expect(journalMeta(browser.tabs)).toEqual({
      tab: 'this-tab',
      savedAt: '2026-10-24T12:00:01.000Z',
      revision: 4,
      fingerprint: FINGERPRINT,
    })
    const next = await openBackupSession(reload(browser))
    expect(await next.own()).toEqual({
      document: named('Osparad'),
      revision: 4,
      fingerprint: FINGERPRINT,
      base: emptyDocument(),
      savedAt: '2026-10-24T12:00:01.000Z',
    })
    expect(browser.tabs.has(JOURNAL)).toBe(false)
  })

  it('replays without a base after the revision moved on', async () => {
    const browser = memory({
      tab: 'this-tab',
      records: [record('this-tab', 'Sparad', '2026-10-24T08:00:00.000Z')],
    })
    const session = await openBackupSession(browser.ports)
    unload(browser.ports)
    session.schedule({ document: named('Efter publicering'), revision: 5, fingerprint: 'next' })
    void session.suspend()
    const next = await openBackupSession(reload(browser))
    // The studio uses the server head as the base, or keeps this document in a conflict.
    expect(await next.own()).toEqual({
      document: named('Efter publicering'),
      revision: 5,
      fingerprint: 'next',
      savedAt: '2026-10-24T12:00:01.000Z',
    })
  })

  it('journals a clean draft as a deletion marker, so an older backup cannot come back', async () => {
    const browser = memory({
      tab: 'this-tab',
      records: [record('this-tab', 'Före publicering', '2026-10-24T08:00:00.000Z')],
    })
    const session = await openBackupSession(browser.ports)
    unload(browser.ports)
    session.schedule(null)
    void session.suspend()
    expect(browser.tabs.get(JOURNAL)).not.toContain('\n')
    const next = await openBackupSession(reload(browser))
    expect(await next.own()).toBeNull()
    expect([...browser.records.keys()]).toEqual([])
    expect(browser.tabs.has(JOURNAL)).toBe(false)
  })

  it('orders the journal after the stored record when the clock went back', async () => {
    const browser = memory({
      tab: 'this-tab',
      records: [record('this-tab', 'Framtid', '2026-10-24T13:00:00.000Z')],
    })
    const session = await openBackupSession(browser.ports)
    unload(browser.ports)
    session.schedule({ document: named('Senare'), revision: 4, fingerprint: FINGERPRINT })
    void session.suspend()
    const next = await openBackupSession(reload(browser))
    expect(await next.own()).toMatchObject({
      document: named('Senare'),
      savedAt: '2026-10-24T13:00:00.001Z',
    })
  })

  it('never lets a journal beat a newer IndexedDB record', async () => {
    const browser = memory({
      tab: 'this-tab',
      records: [record('this-tab', 'Nyare', '2026-10-24T09:00:00.000Z')],
    })
    browser.tabs.set(
      JOURNAL,
      `${JSON.stringify({ tab: 'this-tab', savedAt: '2026-10-24T08:00:00.000Z', revision: 4 })}\n${JSON.stringify(named('Äldre'))}`,
    )
    const session = await openBackupSession(browser.ports)
    expect((await session.own())?.document).toEqual(named('Nyare'))
    expect(browser.ports.records.put).not.toHaveBeenCalled()
    // IndexedDB already confirmed newer data, so the journal is done.
    expect(browser.tabs.has(JOURNAL)).toBe(false)
  })

  it('never replays a copied journal into a tab that is still open', async () => {
    // A window.open'd tab inherits the opener's sessionStorage, journal included.
    const browser = memory({ tab: 'opener', held: ['knc-cms-tab:opener'] })
    browser.tabs.set(
      JOURNAL,
      `${JSON.stringify({ tab: 'opener', savedAt: '2026-10-25' })}\n${JSON.stringify(named('Kopia'))}`,
    )
    const session = await openBackupSession(browser.ports)
    expect(session.tab).toBe('tab-1')
    expect(browser.ports.records.put).not.toHaveBeenCalled()
    expect(browser.records.size).toBe(0)
  })

  it('forgets the journal once IndexedDB confirms the write', async () => {
    const browser = memory({ tab: 'this-tab' })
    const session = await openBackupSession(browser.ports)
    const write = deferred()
    const put = vi.mocked(browser.ports.records.put)
    const store = put.getMockImplementation()
    put.mockImplementation(async (value) => {
      await write.promise
      await store?.(value)
    })
    session.schedule({ document: named('Bekräftas'), revision: 4, fingerprint: FINGERPRINT })
    const written = session.suspend()
    expect(browser.tabs.has(JOURNAL)).toBe(true)
    write.resolve()
    await written
    expect(browser.tabs.has(JOURNAL)).toBe(false)
    expect(browser.records.get('this-tab')?.document).toBe(JSON.stringify(named('Bekräftas')))
  })

  it('keeps the previous journal whole and reports a journal write that does not fit', async () => {
    const browser = memory({
      tab: 'this-tab',
      records: [record('this-tab', 'Sparad', '2026-10-24T08:00:00.000Z')],
    })
    const session = await openBackupSession(browser.ports)
    unload(browser.ports)
    session.schedule({ document: named('Journalförd'), revision: 4, fingerprint: FINGERPRINT })
    void session.suspend()
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    vi.mocked(browser.ports.tabs.setItem).mockImplementation(() => {
      throw quota
    })
    session.schedule({ document: named('För stor'), revision: 4, fingerprint: FINGERPRINT })
    let suspended: Promise<void> = Promise.resolve()
    expect(() => {
      suspended = session.suspend()
    }).not.toThrow()
    await expect(suspended).rejects.toBe(quota)
    const next = await openBackupSession(reload(browser))
    expect((await next.own())?.document).toEqual(named('Journalförd'))
  })

  it('rejects instead of throwing on any other sessionStorage failure', async () => {
    const browser = memory({ tab: 'this-tab' })
    const session = await openBackupSession(browser.ports)
    const failure = new TypeError('sessionStorage is unavailable')
    vi.mocked(browser.ports.tabs.setItem).mockImplementation(() => {
      throw failure
    })
    session.schedule({ document: named('A'), revision: 1, fingerprint: FINGERPRINT })
    let suspended: Promise<void> = Promise.resolve()
    expect(() => {
      suspended = session.suspend()
    }).not.toThrow()
    await expect(suspended).rejects.toBe(failure)
    // The IndexedDB write went on.
    await session.flush()
    expect((await session.own())?.document).toEqual(named('A'))
  })

  it('replays the stale-layouts mark with the journal', async () => {
    const browser = memory({ tab: 'this-tab' })
    const session = await openBackupSession(browser.ports)
    unload(browser.ports)
    session.schedule({
      document: named('Osparad'),
      revision: 4,
      fingerprint: FINGERPRINT,
      layoutsStale: true,
    })
    void session.suspend()
    const next = await openBackupSession(reload(browser))
    expect(await next.own()).toMatchObject({ document: named('Osparad'), layoutsStale: true })
  })

  it('keeps a later edit newer than an adopted draft dated ahead of the clock', async () => {
    const browser = memory({
      tab: 'this-tab',
      records: [record('closed', 'Framtida', '2026-10-24T13:00:00.000Z')],
    })
    const session = await openBackupSession(browser.ports)
    const [offer] = await session.offers()
    if (!offer) throw new Error('An offer was expected')
    expect(await session.adopt(offer)).toBe('done')
    unload(browser.ports)
    // The clock says 12:00:0x, an hour before the adopted draft.
    session.schedule({
      document: named('Senare redigering'),
      revision: 4,
      fingerprint: FINGERPRINT,
    })
    void session.suspend()
    const next = await openBackupSession(reload(browser))
    // The adopted draft is 13:00:00.001, the later edit one millisecond newer.
    expect(await next.own()).toMatchObject({
      document: named('Senare redigering'),
      savedAt: '2026-10-24T13:00:00.002Z',
    })
  })

  it('gives an adopted draft a version no copied pre-adoption journal can beat', async () => {
    const browser = memory({
      tab: 'this-tab',
      records: [record('closed', 'Erbjuden', '2026-10-24T08:00:00.000Z')],
    })
    const session = await openBackupSession(browser.ports)
    session.schedule({ document: named('Före adoption'), revision: 4, fingerprint: FINGERPRINT })
    await session.flush()
    const before = browser.records.get('this-tab')?.savedAt
    // A journal of that write, e.g. inherited by a tab this one opened.
    const copied = `${JSON.stringify({ tab: 'this-tab', savedAt: before, revision: 4, fingerprint: FINGERPRINT })}\n${JSON.stringify(named('Kopierad'))}`
    const [offer] = await session.offers()
    if (!offer) throw new Error('An offer was expected')
    expect(await session.adopt(offer)).toBe('done')
    expect((browser.records.get('this-tab')?.savedAt ?? '') > (before ?? '')).toBe(true)

    // This tab is closed; the copy's next page replays the journal under the same tab id.
    browser.tabs.set(JOURNAL, copied)
    const next = await openBackupSession(reload(browser))
    expect((await next.own())?.document).toEqual(named('Erbjuden'))
  })

  it('reports unsaved work until IndexedDB confirms it', async () => {
    const browser = memory({ tab: 'this-tab' })
    const session = await openBackupSession(browser.ports)
    expect(session.unsaved()).toBe(false)
    const write = deferred()
    const put = vi.mocked(browser.ports.records.put)
    const store = put.getMockImplementation()
    put.mockImplementation(async (value) => {
      await write.promise
      await store?.(value)
    })
    session.schedule({ document: named('Osparad'), revision: 4, fingerprint: FINGERPRINT })
    expect(session.unsaved()).toBe(true)
    const written = session.flush()
    expect(session.unsaved()).toBe(true)
    write.resolve()
    await written
    expect(session.unsaved()).toBe(false)
  })

  // A clean draft schedules a delete: closing the tab then loses nothing, so it never prompts.
  it('never reports a pending delete of a clean draft as unsaved work', async () => {
    const browser = memory({ tab: 'this-tab' })
    const session = await openBackupSession(browser.ports)
    session.schedule(null)
    expect(session.unsaved()).toBe(false)

    // A draft write still in flight, then the draft became clean (e.g. after Publicera).
    const put = deferred()
    const store = vi.mocked(browser.ports.records.put).getMockImplementation()
    vi.mocked(browser.ports.records.put).mockImplementationOnce(async (value) => {
      await put.promise
      await store?.(value)
    })
    session.schedule({ document: named('Publiceras'), revision: 4, fingerprint: FINGERPRINT })
    const putting = session.flush()
    session.schedule(null)
    expect(session.unsaved()).toBe(false)

    // The delete itself in flight.
    const remove = deferred()
    const drop = vi.mocked(browser.ports.records.remove).getMockImplementation()
    vi.mocked(browser.ports.records.remove).mockImplementationOnce(async (tab) => {
      await remove.promise
      await drop?.(tab)
    })
    const removing = session.flush()
    expect(session.unsaved()).toBe(false)
    put.resolve()
    remove.resolve()
    await Promise.all([putting, removing])
    expect(session.unsaved()).toBe(false)

    session.schedule({ document: named('Ny ändring'), revision: 5, fingerprint: FINGERPRINT })
    expect(session.unsaved()).toBe(true)
  })
})

// The business names of the drafts this tab sent to IndexedDB, in call order.
const sent = (ports: BackupPorts): unknown[] => {
  const documents = vi.mocked(ports.records.put).mock.calls.map(([stored]) => stored.document)
  return documents.map((json) => (JSON.parse(json) as CmsDocument).settings.business_name)
}

describe('a write IndexedDB refused', () => {
  const refusal = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
  // IndexedDB answers the next write only once `answer` resolves, then refuses it.
  const refuseLater = (ports: BackupPorts, answer: Promise<void>): void => {
    vi.mocked(ports.records.put).mockImplementationOnce(async () => {
      await answer
      throw refusal
    })
  }

  // The debounced write was refused and no edit followed: closing or hiding the tab must still
  // write the draft once IndexedDB takes it again.
  it.each(['flush', 'suspend'] as const)(
    'writes the refused draft again on %s while nothing newer is scheduled',
    async (action) => {
      vi.useFakeTimers()
      const browser = memory({ tab: 'this-tab' })
      const session = await openBackupSession(browser.ports)
      vi.mocked(browser.ports.records.put).mockRejectedValueOnce(refusal)
      const report = vi.fn()
      session.schedule({ document: named('Nekad'), revision: 4, fingerprint: FINGERPRINT }, report)
      await vi.advanceTimersByTimeAsync(500)
      expect(report).toHaveBeenCalledWith(refusal)
      expect(browser.records.has('this-tab')).toBe(false)
      expect(session.unsaved()).toBe(true)

      await session[action]()
      expect(sent(browser.ports)).toEqual(['Nekad', 'Nekad'])
      expect((await session.own())?.document).toEqual(named('Nekad'))
      expect(session.unsaved()).toBe(false)
      expect(browser.tabs.has(JOURNAL)).toBe(false)
    },
  )

  it('never writes a refused draft after a newer one', async () => {
    const { ports } = memory({ tab: 'this-tab' })
    const session = await openBackupSession(ports)
    vi.mocked(ports.records.put).mockRejectedValueOnce(refusal)
    session.schedule({ document: named('Nekad'), revision: 4, fingerprint: FINGERPRINT })
    await expect(session.flush()).rejects.toBe(refusal)
    session.schedule({ document: named('Nyare'), revision: 4, fingerprint: FINGERPRINT })
    await session.flush()
    await session.flush()
    expect(sent(ports)).toEqual(['Nekad', 'Nyare'])
    expect((await session.own())?.document).toEqual(named('Nyare'))
  })

  it('never writes again a refused draft that a newer write had already replaced', async () => {
    const { ports } = memory({ tab: 'this-tab' })
    const session = await openBackupSession(ports)
    const answer = deferred()
    refuseLater(ports, answer.promise)
    session.schedule({ document: named('Nekad'), revision: 4, fingerprint: FINGERPRINT })
    const refused = session.flush()
    session.schedule({ document: named('Nyare'), revision: 4, fingerprint: FINGERPRINT })
    const newer = session.flush()
    answer.resolve()
    await expect(refused).rejects.toBe(refusal)
    await newer
    await session.flush()
    expect(sent(ports)).toEqual(['Nekad', 'Nyare'])
    expect((await session.own())?.document).toEqual(named('Nyare'))
    expect(session.unsaved()).toBe(false)
  })

  // The tab closes while the debounced write is in flight: beforeunload's flush and pagehide's
  // suspend wait for it, and IndexedDB refuses it meanwhile. One more write goes, not one per call.
  it('writes the draft once more when IndexedDB refuses the write a flush waits for', async () => {
    vi.useFakeTimers()
    const browser = memory({ tab: 'this-tab' })
    const session = await openBackupSession(browser.ports)
    const answer = deferred()
    refuseLater(browser.ports, answer.promise)
    const report = vi.fn()
    session.schedule({ document: named('I luften'), revision: 4, fingerprint: FINGERPRINT }, report)
    await vi.advanceTimersByTimeAsync(500)
    expect(sent(browser.ports)).toEqual(['I luften'])
    const leaving = session.flush()
    const hiding = session.suspend()
    answer.resolve()
    await Promise.all([leaving, hiding])
    expect(report).toHaveBeenCalledWith(refusal)
    expect(sent(browser.ports)).toEqual(['I luften', 'I luften'])
    expect((await session.own())?.document).toEqual(named('I luften'))
    expect(session.unsaved()).toBe(false)
    expect(browser.tabs.has(JOURNAL)).toBe(false)
  })

  it('sends one retry for flushes that overlap it', async () => {
    const { ports } = memory({ tab: 'this-tab' })
    const session = await openBackupSession(ports)
    vi.mocked(ports.records.put).mockRejectedValueOnce(refusal)
    session.schedule({ document: named('Nekad'), revision: 4, fingerprint: FINGERPRINT })
    await expect(session.flush()).rejects.toBe(refusal)
    const answer = deferred()
    const store = vi.mocked(ports.records.put).getMockImplementation()
    vi.mocked(ports.records.put).mockImplementationOnce(async (value) => {
      await answer.promise
      await store?.(value)
    })
    const first = session.flush()
    const second = session.flush()
    answer.resolve()
    await Promise.all([first, second])
    expect(sent(ports)).toEqual(['Nekad', 'Nekad'])
    expect(session.unsaved()).toBe(false)
  })

  it('makes one attempt per flush while IndexedDB keeps refusing', async () => {
    const { ports } = memory({ tab: 'this-tab' })
    const session = await openBackupSession(ports)
    vi.mocked(ports.records.put).mockRejectedValue(refusal)
    session.schedule({ document: named('Nekad'), revision: 4, fingerprint: FINGERPRINT })
    await expect(session.flush()).rejects.toBe(refusal)
    await expect(session.flush()).rejects.toBe(refusal)
    expect(sent(ports)).toEqual(['Nekad', 'Nekad'])
    // Still unsaved: the leave prompt keeps protecting the draft.
    expect(session.unsaved()).toBe(true)
  })

  // A clean draft's delete was refused: the old record must not be offered after the tab closes.
  it('removes a clean draft again after IndexedDB refused the delete', async () => {
    const { ports, records } = memory({
      tab: 'this-tab',
      records: [record('this-tab', 'Före publicering', '2026-10-24T08:00:00.000Z')],
    })
    const session = await openBackupSession(ports)
    vi.mocked(ports.records.remove).mockRejectedValueOnce(refusal)
    session.schedule(null)
    await expect(session.flush()).rejects.toBe(refusal)
    expect(records.has('this-tab')).toBe(true)
    expect(session.unsaved()).toBe(false)
    await session.flush()
    expect(ports.records.remove).toHaveBeenCalledTimes(2)
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
