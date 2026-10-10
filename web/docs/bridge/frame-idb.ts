/**
 * The frame-side IndexedDB database "uniwork-office-frame-drafts" (CONTRACT C18 / C18a), shared by
 * draft recovery and the PDF saved-signature store. Two object stores, both with out-of-line keys,
 * both created at version 1 by whichever side opens the database first (the host creates the same
 * two, dev-uniwork draft-session-key.ts):
 *   - `drafts`  the frame's encrypted records: draft copies `scope:baseEtag:tabId`, and the PDF
 *               saved-signature list under the reserved key `~signatures:<user>`
 *   - `keys`    the host's persisted non-extractable session keys (key = user id); the frame never
 *               touches it: its key always comes from `init.recovery`
 * The version is never bumped from here (the host opens version 1; a higher version would make that
 * open fail): both sides open without a version and rely on the stores above. The host deletes the
 * whole database on sign-out / session switch, so every connection is short-lived and closes on
 * `versionchange`.
 */

export const FRAME_DB = 'uniwork-office-frame-drafts'
export const STORE_DRAFTS = 'drafts'
export const STORE_KEYS = 'keys'
const STORES = [STORE_DRAFTS, STORE_KEYS]

/** the saved-signature record of one user, in the `drafts` store; `~` never starts a user id */
export const signatureRecordKey = (user: string) => `~signatures:${user}`

export function settle<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function ensureStores(db: IDBDatabase): void {
  for (const name of STORES) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
  }
}

/** Open the database; a new one gets both stores at version 1, an existing one is used as it is. */
export function openFrameDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(FRAME_DB)
    req.onupgradeneeded = () => ensureStores(req.result)
    req.onsuccess = () => {
      const db = req.result
      // the host's sign-out deleteDatabase must never wait on this frame
      db.onversionchange = () => db.close()
      resolve(db)
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
