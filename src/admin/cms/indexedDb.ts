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

export async function openKeyedStore(database: string, keyPath: string): Promise<KeyedStore> {
  const opening = indexedDB.open(database, 1)
  opening.onupgradeneeded = () => opening.result.createObjectStore('records', { keyPath })
  const db = await settled(opening)
  db.onversionchange = () => db.close()
  const run = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('records', mode, { durability: 'strict' })
      const request = work(transaction.objectStore('records'))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () =>
        reject(transaction.error ?? new DOMException('Aborted', 'AbortError'))
    })
  return {
    all: () => run('readonly', (store) => store.getAll()),
    put: async (value) => void (await run('readwrite', (store) => store.put(value))),
    remove: async (key) => void (await run('readwrite', (store) => store.delete(key))),
  }
}
