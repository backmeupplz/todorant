/** A tiny IndexedDB key-value layer: one object store per name, values keyed by id */
const STORES = ['todo', 'tag', 'meta'] as const
export type Store = (typeof STORES)[number]

let db: Promise<IDBDatabase> | undefined
function open() {
  return (db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('todorant', 1)
    req.onupgradeneeded = () => STORES.forEach((s) => req.result.createObjectStore(s))
    req.onsuccess = () => {
      // Let another tab delete or upgrade the database instead of blocking it forever
      req.result.onversionchange = () => (req.result.close(), (db = undefined))
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  }))
}

const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => ((tx.oncomplete = () => res()), (tx.onerror = () => rej(tx.error))))

export async function all<T>(store: Store): Promise<Map<string, T>> {
  const tx = (await open()).transaction(store)
  const s = tx.objectStore(store)
  const [keys, values] = await Promise.all(
    [s.getAllKeys(), s.getAll()].map((r) => new Promise<any[]>((res) => (r.onsuccess = () => res(r.result)))),
  )
  return new Map(keys.map((k, i) => [String(k), values[i]]))
}

/** Writes (value) or deletes (undefined) many keys across stores in one transaction */
export async function write(changes: [Store, string, unknown][]) {
  if (!changes.length) return
  const tx = (await open()).transaction(STORES, 'readwrite')
  for (const [store, key, value] of changes) {
    if (value === undefined) tx.objectStore(store).delete(key)
    else tx.objectStore(store).put(value, key)
  }
  await done(tx)
}

export async function clear() {
  const tx = (await open()).transaction(STORES, 'readwrite')
  STORES.forEach((s) => tx.objectStore(s).clear())
  await done(tx)
}
