import { afterEach, describe, expect, it, vi } from 'vitest'
import { openKeyedStore } from '../../src/admin/cms/indexedDb'

// One connection of the fake: 'open' commits every transaction; 'closing' makes transaction()
// throw InvalidStateError, as after close(); an error aborts every transaction with it, as Safari
// does once it lost its IndexedDB server.
interface Connection {
  db: IDBDatabase
  state: 'open' | 'closing' | DOMException
}

// IndexedDB as a fake factory over one record map; every open() is a new connection, born in the
// state `born` gives it. An open succeeds once `hold` settles for its index (at once without it).
function fakeIndexedDb(
  born: (index: number) => Connection['state'] = () => 'open',
  hold: (index: number) => Promise<void> = () => Promise.resolve(),
) {
  const records = new Map<string, unknown>()
  const connections: Connection[] = []
  const connect = (): Connection => {
    const connection = { state: born(connections.length) } as Connection
    const transaction = () => {
      if (connection.state === 'closing')
        throw new DOMException('The database connection is closing.', 'InvalidStateError')
      const failure = connection.state === 'open' ? null : connection.state
      const request: { result?: unknown; onsuccess?: () => void } = {}
      let apply = (): void => undefined
      const pending = (effect: () => void) => {
        apply = effect
        return request
      }
      const created = {
        error: null as DOMException | null,
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        commit: () => undefined,
        objectStore: () => ({
          put: (value: { tab: string }) => pending(() => void records.set(value.tab, value)),
          getAll: () => pending(() => void (request.result = [...records.values()])),
          delete: (key: string) => pending(() => void records.delete(key)),
        }),
      }
      queueMicrotask(() => {
        if (failure) {
          created.error = failure
          created.onabort?.()
          return
        }
        apply()
        request.onsuccess?.()
        created.oncomplete?.()
      })
      return created
    }
    const close = () => {
      connection.state = 'closing'
    }
    connection.db = { transaction, close } as unknown as IDBDatabase
    connections.push(connection)
    return connection
  }
  vi.stubGlobal('indexedDB', {
    open: () => {
      const opening: { result?: IDBDatabase; onsuccess?: () => void } = {}
      const held = hold(connections.length)
      const { db } = connect()
      void held.then(() => {
        opening.result = db
        opening.onsuccess?.()
      })
      return opening
    },
  })
  const nth = (index: number): Connection => {
    const connection = connections[index]
    if (!connection) throw new Error(`No connection ${index}`)
    return connection
  }
  return { records, connections, nth }
}

const draft = { tab: 'this-tab', document: '{}' }
const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
const serverLost = new DOMException(
  'Connection to Indexed Database server lost. Refresh the page to try again',
  'UnknownError',
)

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// The reopen waits behind another page's blocked upgrade or deleteDatabase: open() does not settle.
describe('IndexedDB reopen that waits in the connection queue', () => {
  const never = (): Promise<void> => new Promise(() => undefined)
  // How the operation ended so far: undefined while it waits.
  const outcome = (operation: Promise<unknown>) => {
    const seen: { reason?: unknown; done?: true } = {}
    operation.then(
      () => (seen.done = true),
      (reason: unknown) => (seen.reason = reason),
    )
    return seen
  }

  it('rejects the operation with a TimeoutError at the bound, not before', async () => {
    vi.useFakeTimers()
    const fake = fakeIndexedDb(undefined, (index) => (index === 0 ? Promise.resolve() : never()))
    const store = await openKeyedStore('knc-cms-drafts', 'tab')
    fake.nth(0).db.close()
    const put = outcome(store.put(draft))
    await vi.advanceTimersByTimeAsync(4999)
    expect(put).toEqual({})
    await vi.advanceTimersByTimeAsync(1)
    expect(put.reason).toMatchObject({ name: 'TimeoutError' })
    expect(fake.connections).toHaveLength(2)
  })

  it('lets every waiting operation share one open, each with its own bound', async () => {
    vi.useFakeTimers()
    const fake = fakeIndexedDb(undefined, (index) => (index === 0 ? Promise.resolve() : never()))
    const store = await openKeyedStore('knc-cms-drafts', 'tab')
    fake.nth(0).db.close()
    const first = outcome(store.put(draft))
    const second = outcome(store.all())
    await vi.advanceTimersByTimeAsync(2500)
    // Started while the reopen is pending: it waits for that open, not a new one.
    const later = outcome(store.put(draft))
    await vi.advanceTimersByTimeAsync(2500)
    expect(first.reason).toMatchObject({ name: 'TimeoutError' })
    expect(second.reason).toMatchObject({ name: 'TimeoutError' })
    expect(later).toEqual({})
    await vi.advanceTimersByTimeAsync(2500)
    expect(later.reason).toMatchObject({ name: 'TimeoutError' })
    expect(fake.connections).toHaveLength(2)
  })

  it('adopts an open that succeeds late; the expired operation never writes', async () => {
    vi.useFakeTimers()
    let release = (): void => undefined
    const late = new Promise<void>((done) => {
      release = done
    })
    const fake = fakeIndexedDb(undefined, (index) => (index === 0 ? Promise.resolve() : late))
    const store = await openKeyedStore('knc-cms-drafts', 'tab')
    fake.nth(0).db.close()
    const expired = outcome(store.put(draft))
    await vi.advanceTimersByTimeAsync(5000)
    expect(expired.reason).toMatchObject({ name: 'TimeoutError' })
    release()
    const next = { tab: 'next-tab', document: '{}' }
    await store.put(next)
    expect(fake.connections).toHaveLength(2)
    expect([...fake.records.values()]).toEqual([next])
  })
})

describe('IndexedDB store over a connection the browser closed', () => {
  it.each([
    {
      by: 'close()',
      close: (connection: Connection) => connection.db.close(),
    },
    {
      by: 'an upgrade in another page',
      close: (connection: Connection) =>
        connection.db.onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent),
    },
  ])('opens a new connection after $by and writes once more', async ({ close }) => {
    const fake = fakeIndexedDb()
    const store = await openKeyedStore('knc-cms-drafts', 'tab')
    close(fake.nth(0))
    await store.put(draft)
    expect(fake.connections).toHaveLength(2)
    expect(fake.records.get('this-tab')).toEqual(draft)
  })

  // Safari aborts the transactions with UnknownError without failing transaction() itself; only
  // the close event tells the connection is gone.
  it('opens a new connection after Safari lost its IndexedDB server', async () => {
    const fake = fakeIndexedDb()
    const store = await openKeyedStore('knc-cms-drafts', 'tab')
    const first = fake.nth(0)
    first.state = serverLost
    first.db.onclose?.(new Event('close'))
    await store.put(draft)
    expect(fake.connections).toHaveLength(2)
    expect(fake.records.get('this-tab')).toEqual(draft)
  })

  it('hands the refusal of the new connection to the caller, after one reopen', async () => {
    const fake = fakeIndexedDb((index) => (index === 0 ? 'open' : quota))
    const store = await openKeyedStore('knc-cms-drafts', 'tab')
    fake.nth(0).db.close()
    await expect(store.put(draft)).rejects.toBe(quota)
    expect(fake.connections).toHaveLength(2)
    // The new connection is alive: its next refusal needs no other connection.
    await expect(store.put(draft)).rejects.toBe(quota)
    expect(fake.connections).toHaveLength(2)
  })

  it('opens at most one new connection per operation, also when that one is closed', async () => {
    const fake = fakeIndexedDb((index) => (index === 0 ? 'open' : 'closing'))
    const store = await openKeyedStore('knc-cms-drafts', 'tab')
    fake.nth(0).db.close()
    await expect(store.put(draft)).rejects.toMatchObject({ name: 'InvalidStateError' })
    expect(fake.connections).toHaveLength(2)
  })

  it('gives operations refused on the same connection one new connection', async () => {
    const fake = fakeIndexedDb()
    const store = await openKeyedStore('knc-cms-drafts', 'tab')
    fake.nth(0).db.close()
    await Promise.all([store.put(draft), store.all()])
    expect(fake.connections).toHaveLength(2)
  })

  it('hands a refusal on a live connection to the caller without a new connection', async () => {
    const fake = fakeIndexedDb()
    const store = await openKeyedStore('knc-cms-drafts', 'tab')
    fake.nth(0).state = quota
    await expect(store.put(draft)).rejects.toBe(quota)
    expect(fake.connections).toHaveLength(1)
  })
})
