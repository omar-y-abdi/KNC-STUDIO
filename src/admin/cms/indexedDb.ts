// Promise wrapper for one keyed IndexedDB object store. Writes resolve only after their
// transaction committed, so a caller may then delete the copy the write replaced.
export interface KeyedStore {
  all(): Promise<unknown[]>
  put(value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

const settled = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

// A connection the browser closed refuses every later transaction: Safari can lose its IndexedDB
// server (the close event), and another page's upgrade closes this one (versionchange).
const closed = new WeakSet<IDBDatabase>()
function dead(db: IDBDatabase): boolean {
  if (closed.has(db)) return true
  try {
    // Throws InvalidStateError once the connection is closing; otherwise an empty transaction
    // that completes at once.
    db.transaction('records')
    return false
  } catch (reason) {
    return reason instanceof DOMException && reason.name === 'InvalidStateError'
  }
}

// A local open settles within milliseconds; 5 s is far above that and still reports the failure
// while the owner is on the page.
const REOPEN_BOUND = 5000
const bounded = <T>(pending: Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DOMException('IndexedDB did not reopen in time.', 'TimeoutError')),
      REOPEN_BOUND,
    )
    void pending.then(resolve, reject).finally(() => clearTimeout(timer))
  })

function transact<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('records', mode, { durability: 'strict' })
    const request = work(transaction.objectStore('records'))
    // An explicitly committed transaction may complete before the request's result is readable.
    let result: T
    request.onsuccess = () => {
      result = request.result
    }
    transaction.oncomplete = () => resolve(result)
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException('Aborted', 'AbortError'))
    // Commit a write now instead of after its result reaches this page, which may be gone.
    if (mode === 'readwrite') transaction.commit()
  })
}

export async function openKeyedStore(database: string, keyPath: string): Promise<KeyedStore> {
  const connect = async (): Promise<IDBDatabase> => {
    const opening = indexedDB.open(database, 1)
    opening.onupgradeneeded = () => opening.result.createObjectStore('records', { keyPath })
    const db = await settled(opening)
    db.onversionchange = () => {
      db.close()
      closed.add(db)
    }
    db.onclose = () => closed.add(db)
    return db
  }
  let db = await connect()
  // One reopen at a time, shared by every operation that needs it. It may wait in the connection
  // queue behind another page's upgrade or deleteDatabase, without an event for this page, so each
  // operation waits for it at most REOPEN_BOUND. A late success becomes the connection.
  let reopening: Promise<IDBDatabase> | null = null
  const reopen = (): Promise<IDBDatabase> => {
    reopening ??= connect().then(
      (opened) => {
        db = opened
        reopening = null
        return opened
      },
      (reason: unknown) => {
        reopening = null
        throw reason
      },
    )
    return bounded(reopening)
  }
  // A refusal on a dead connection gets one new connection and one more attempt, whose error
  // reaches the caller unchanged. Any other refusal reaches it as is.
  const run = async <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const used = reopening ? await reopen() : db
    try {
      return await transact(used, mode, work)
    } catch (reason) {
      if (!dead(used)) throw reason
      // An operation refused on a connection already replaced uses the new one.
      return transact(used === db ? await reopen() : db, mode, work)
    }
  }
  return {
    all: () => run('readonly', (store) => store.getAll()),
    put: async (value) => void (await run('readwrite', (store) => store.put(value))),
    remove: async (key) => void (await run('readwrite', (store) => store.delete(key))),
  }
}
