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
  let connection = connect()
  await connection
  // A refusal on a dead connection (closed, or a reopen that failed) gets one new connection and
  // one more attempt, whose error reaches the caller unchanged. Any other refusal reaches it as is.
  const run = async <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const used = connection
    try {
      return await transact(await used, mode, work)
    } catch (reason) {
      if (!(await used.then(dead, () => true))) throw reason
      // Operations refused on the same connection share one new connection.
      if (connection === used) connection = connect()
      return transact(await connection, mode, work)
    }
  }
  return {
    all: () => run('readonly', (store) => store.getAll()),
    put: async (value) => void (await run('readwrite', (store) => store.put(value))),
    remove: async (key) => void (await run('readwrite', (store) => store.delete(key))),
  }
}
