/**
 * A minimal in-memory IDBFactory for unit tests of ../draft-recovery.ts: open (+ upgrade),
 * deleteDatabase, object stores with out-of-line keys, put / get / getAllKeys / delete.
 * Values are stored by structured clone, like the real thing. Callbacks fire asynchronously.
 */
type Store = Map<string, unknown>

interface FakeRequest<T> {
  result: T
  error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}

function request<T>(produce: () => T, after?: () => void): FakeRequest<T> {
  const req: FakeRequest<T> = {
    result: undefined as T,
    error: null,
    onsuccess: null,
    onerror: null,
  }
  queueMicrotask(() => {
    try {
      req.result = produce()
      req.onsuccess?.()
    } catch (err) {
      req.error = err
      req.onerror?.()
    }
    after?.()
  })
  return req
}

export function createFakeIdb() {
  const dbs = new Map<string, { version: number; stores: Map<string, Store> }>()
  let openConnections = 0

  function database(name: string, entry: { version: number; stores: Map<string, Store> }) {
    const stores = entry.stores
    let closed = false
    const db = {
      name,
      get version() {
        return entry.version
      },
      onversionchange: null as (() => void) | null,
      objectStoreNames: { contains: (s: string) => stores.has(s) },
      createObjectStore(s: string) {
        stores.set(s, new Map())
      },
      close() {
        if (!closed) openConnections--
        closed = true
      },
      transaction(storeName: string) {
        const store = stores.get(storeName)
        if (!store) throw new Error(`no store ${storeName}`)
        let pending = 0
        const tx = {
          oncomplete: null as (() => void) | null,
          onabort: null as (() => void) | null,
          onerror: null as (() => void) | null,
          error: null,
          objectStore: () => objectStore,
        }
        const settle = () => {
          // like the real auto-commit: completes once no request is pending after a turn
          setTimeout(() => {
            if (pending === 0) tx.oncomplete?.()
          }, 0)
        }
        const track = <T>(produce: () => T) => {
          pending++
          return request(produce, () => {
            pending--
            settle()
          })
        }
        const objectStore = {
          put: (value: unknown, key: string) =>
            track(() => {
              store.set(key, structuredClone(value))
              return key
            }),
          get: (key: string) => track(() => structuredClone(store.get(key))),
          getAllKeys: () => track(() => [...store.keys()].sort()),
          delete: (key: string) =>
            track(() => {
              store.delete(key)
              return undefined
            }),
        }
        settle()
        return tx
      },
    }
    return db
  }

  const factory = {
    open(name: string, version?: number) {
      const req = {
        result: null as unknown,
        error: null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
        onblocked: null as (() => void) | null,
      }
      queueMicrotask(() => {
        const existing = dbs.get(name)
        const upgrade = !existing || (version !== undefined && version > existing.version)
        const entry = existing ?? { version: 0, stores: new Map<string, Store>() }
        if (!existing) dbs.set(name, entry)
        if (upgrade) entry.version = version ?? 1
        const db = database(name, entry)
        openConnections++
        req.result = db
        if (upgrade) req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
    deleteDatabase(name: string) {
      return request(() => {
        dbs.delete(name)
        return undefined
      })
    },
  }

  return {
    idb: factory as unknown as IDBFactory,
    /** raw view of one store (keys -> stored values) */
    store: (db: string, store: string): Store | undefined => dbs.get(db)?.stores.get(store),
    /** pre-create the database as another party (the host) would, with only these stores */
    seed: (db: string, version: number, storeNames: string[]) => {
      dbs.set(db, { version, stores: new Map(storeNames.map((n) => [n, new Map()])) })
    },
    version: (db: string): number | undefined => dbs.get(db)?.version,
    openConnections: () => openConnections,
  }
}
