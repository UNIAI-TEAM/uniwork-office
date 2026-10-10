/**
 * The frame-side IndexedDB database "uniwork-office-frame-drafts" (CONTRACT C18 / C18a), shared by
 * draft recovery and the PDF saved-signature store. Three object stores live in it:
 *   - `drafts`      encrypted draft copies (frame writes, ./draft-recovery.ts)
 *   - `signatures`  the user's encrypted saved PDF signatures (frame writes, web/modules/pdf)
 *   - `keys`        the host's persisted non-extractable session keys (the HOST owns it; the frame
 *                   only makes sure the store exists so either side can open the database first)
 * The host deletes the whole database on sign-out / session switch, so every connection here is
 * short-lived and closes on `versionchange`.
 */

export const FRAME_DB = 'uniwork-office-frame-drafts'
export const STORE_DRAFTS = 'drafts'
export const STORE_SIGNATURES = 'signatures'
export const STORE_KEYS = 'keys'
const ALL_STORES = [STORE_DRAFTS, STORE_SIGNATURES, STORE_KEYS]

export function settle<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function ensureStores(db: IDBDatabase): void {
  for (const name of ALL_STORES) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
  }
}

/**
 * Open the database with every store present. Whichever side (frame or host) opens first creates
 * all three; if the host created the database with only its own store, the frame upgrades it.
 */
export function openFrameDb(idb: IDBFactory, version?: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = version === undefined ? idb.open(FRAME_DB) : idb.open(FRAME_DB, version)
    req.onupgradeneeded = () => ensureStores(req.result)
    req.onsuccess = () => {
      const db = req.result
      // the host's sign-out deleteDatabase must never wait on this frame
      db.onversionchange = () => db.close()
      if (ALL_STORES.every((name) => db.objectStoreNames.contains(name))) {
        resolve(db)
        return
      }
      db.close()
      openFrameDb(idb, db.version + 1).then(resolve, reject)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('frame database blocked'))
  })
}

/** one short transaction per call; the connection closes right after */
export async function withStore<T>(
  idb: IDBFactory,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openFrameDb(idb)
  try {
    const tx = db.transaction(storeName, mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('frame database transaction aborted'))
      tx.onerror = () => reject(tx.error)
    })
    const result = await run(tx.objectStore(storeName))
    await done
    return result
  } finally {
    db.close()
  }
}

/**
 * The user part of a recovery scope ("<userId>:<documentId>", opaque to the frame otherwise): what
 * the per-user stores (saved signatures) are keyed by. A scope without a colon is used whole.
 */
export function userOfScope(scope: string): string {
  const at = scope.lastIndexOf(':')
  return at > 0 ? scope.slice(0, at) : scope
}
