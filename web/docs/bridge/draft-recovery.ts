/**
 * Web draft recovery (CONTRACT C15(3) / C18), shared by the Docs bridge and every module bridge.
 *
 * While the document is dirty the frame keeps an encrypted copy of its current bytes in this
 * browser so a crashed or closed tab does not lose the edits:
 *   - every 30 s (and on `pagehide`) the bridge's "current bytes" are encrypted with the host's
 *     per-session AES-GCM key (`init.recovery.key`, non-extractable) and written to IndexedDB
 *     database "uniwork-office-frame-drafts", store "drafts", key `scope + ":" + baseEtag`;
 *   - a successful save or an explicit Discard deletes the scope's records;
 *   - on open, a record for the scope (same etag, or an older one, labelled as such) is decrypted
 *     and offered as Restore / Discard; Restore loads the bytes as a dirty document;
 *   - a record that does not decrypt (another session's key) is deleted silently.
 * Never sent to the host or the server, never `api.save`, never a version (C10 holds). Without
 * `init.recovery` nothing is written and nothing is shown. The host deletes the whole database on
 * sign-out, so every connection here is short-lived and closes on `versionchange`.
 */
import type { InitRecovery, OfficeModule } from '../protocol/types'

export const DRAFTS_DB = 'uniwork-office-frame-drafts'
export const DRAFTS_STORE = 'drafts'
/** write interval while dirty (C18) */
export const DRAFT_INTERVAL_MS = 30_000

/** one stored draft (the IndexedDB value; the key is out of line) */
export interface DraftRecord {
  iv: Uint8Array<ArrayBuffer>
  ciphertext: ArrayBuffer
  baseEtag: string
  savedAt: number
  module: OfficeModule
  name: string
}

export interface DraftStore {
  put(key: string, record: DraftRecord): Promise<void>
  /** every record whose key starts with `prefix` */
  list(prefix: string): Promise<Array<{ key: string; record: DraftRecord }>>
  delete(key: string): Promise<void>
}

// ---------------------------------------------------------------- IndexedDB store

function settle<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(DRAFTS_DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DRAFTS_STORE)) {
        req.result.createObjectStore(DRAFTS_STORE)
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // the host's sign-out deleteDatabase must never wait on this frame
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('draft database blocked'))
  })
}

/** one short transaction per call; the connection closes right after */
async function withStore<T>(
  idb: IDBFactory,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb(idb)
  try {
    const tx = db.transaction(DRAFTS_STORE, mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('draft transaction aborted'))
      tx.onerror = () => reject(tx.error)
    })
    const result = await run(tx.objectStore(DRAFTS_STORE))
    await done
    return result
  } finally {
    db.close()
  }
}

export function createIdbDraftStore(idb: IDBFactory = indexedDB): DraftStore {
  return {
    async put(key, record) {
      await withStore(idb, 'readwrite', (s) => settle(s.put(record, key)))
    },
    list(prefix) {
      return withStore(idb, 'readonly', async (s) => {
        // few records per origin: filter the keys here instead of an IDBKeyRange
        const keys = (await settle(s.getAllKeys())).map(String).filter((k) => k.startsWith(prefix))
        const out: Array<{ key: string; record: DraftRecord }> = []
        for (const key of keys) out.push({ key, record: (await settle(s.get(key))) as DraftRecord })
        return out
      })
    },
    async delete(key) {
      await withStore(idb, 'readwrite', (s) => settle(s.delete(key)))
    },
  }
}

// ---------------------------------------------------------------- crypto

function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s)
}

/** AES-GCM; the record key is the additional data, so a record cannot be moved to another key */
export async function encryptDraft(
  key: CryptoKey,
  recordKey: string,
  bytes: ArrayBuffer | Uint8Array,
): Promise<{ iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(recordKey) },
    key,
    bytes as BufferSource,
  )
  return { iv, ciphertext }
}

/** null when the record is not ours (another session's key) or damaged */
export async function decryptDraft(
  key: CryptoKey,
  recordKey: string,
  record: DraftRecord,
): Promise<ArrayBuffer | null> {
  try {
    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv, additionalData: utf8(recordKey) },
      key,
      record.ciphertext,
    )
  } catch {
    return null
  }
}

function isRecord(x: unknown): x is DraftRecord {
  if (typeof x !== 'object' || x === null) return false
  const r = x as Record<string, unknown>
  return (
    // tag checks, not instanceof: a stored value may come back from another realm
    Object.prototype.toString.call(r.iv) === '[object Uint8Array]' &&
    Object.prototype.toString.call(r.ciphertext) === '[object ArrayBuffer]' &&
    typeof r.baseEtag === 'string' &&
    typeof r.savedAt === 'number' &&
    typeof r.name === 'string'
  )
}

// ---------------------------------------------------------------- controller

/** what the prompt shows */
export interface DraftInfo {
  name: string
  savedAt: number
  baseEtag: string
  /** the draft was written against another (older) version than the one open now */
  older: boolean
}

/** 'dismiss' (Escape) keeps the record and restores nothing */
export type DraftChoice = 'restore' | 'discard' | 'dismiss'

/** the bridge's view of its document */
export interface DraftHost {
  /** the open document; null while none is open (nothing is written) */
  file(): { etag?: string; name: string } | null
  isDirty(): boolean
  /** the bytes a save would write right now; null = nothing to keep */
  bytes(): Promise<ArrayBuffer | Uint8Array | null>
  /** load these bytes as a dirty document (the user still has to save) */
  restore(bytes: ArrayBuffer, draft: DraftInfo): Promise<void> | void
}

export interface DraftRecoveryOptions {
  module: OfficeModule
  /** the host's grant, read at every use (a later `init` after a reload replaces it) */
  recovery: () => InitRecovery | undefined
  host: DraftHost
  prompt: (draft: DraftInfo) => Promise<DraftChoice>
  /** default: IndexedDB of this window */
  store?: DraftStore
  intervalMs?: number
  /** where `pagehide` is observed (default: window) */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  now?: () => number
}

export interface DraftRecovery {
  /** a document was opened: offer its draft, if any (resolves once the prompt is answered) */
  opened(): Promise<void>
  /** a save landed: the scope's drafts are obsolete */
  saved(): Promise<void>
  /** write the current bytes now if dirty (the timer and `pagehide` call this) */
  flush(): Promise<void>
  dispose(): void
}

function recordKey(scope: string, etag: string | undefined): string {
  return `${scope}:${etag ?? ''}`
}

export function createDraftRecovery(opts: DraftRecoveryOptions): DraftRecovery {
  const now = opts.now ?? Date.now
  let store: DraftStore | null = opts.store ?? null
  const target = opts.target ?? (typeof window !== 'undefined' ? window : undefined)
  // every store operation runs in order: a save that lands while a write is in flight
  // deletes after that write, and nothing is written while the prompt is open
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false

  function getStore(): DraftStore | null {
    if (!store && typeof indexedDB !== 'undefined') store = createIdbDraftStore(indexedDB)
    return store
  }

  function enqueue<T>(job: () => Promise<T>): Promise<T | undefined> {
    const run = queue.then(job).catch((err: unknown) => {
      console.warn('[office-web] draft recovery:', err)
      return undefined
    })
    queue = run
    return run
  }

  async function deleteScope(s: DraftStore, scope: string, keep?: string): Promise<void> {
    for (const { key } of await s.list(`${scope}:`)) if (key !== keep) await s.delete(key)
  }

  async function write(): Promise<void> {
    const grant = opts.recovery()
    const s = getStore()
    const file = opts.host.file()
    if (disposed || !grant || !s || !file || !opts.host.isDirty()) return
    const bytes = await opts.host.bytes()
    if (!bytes || !opts.host.isDirty()) return
    const key = recordKey(grant.scope, file.etag)
    const { iv, ciphertext } = await encryptDraft(grant.key, key, bytes)
    await s.put(key, {
      iv,
      ciphertext,
      baseEtag: file.etag ?? '',
      savedAt: now(),
      module: opts.module,
      name: file.name,
    })
  }

  async function offer(): Promise<void> {
    const grant = opts.recovery()
    const s = getStore()
    const file = opts.host.file()
    if (disposed || !grant || !s || !file) return
    const current = recordKey(grant.scope, file.etag)
    let best: { key: string; record: DraftRecord; bytes: ArrayBuffer } | null = null
    for (const { key, record } of await s.list(`${grant.scope}:`)) {
      const bytes = isRecord(record) ? await decryptDraft(grant.key, key, record) : null
      if (!bytes) {
        await s.delete(key) // another session's key or damaged: unusable
        continue
      }
      // the draft of the version open now wins; else the newest older one
      const better =
        !best ||
        (key === current && best.key !== current) ||
        (best.key !== current && record.savedAt > best.record.savedAt)
      if (better) best = { key, record, bytes }
    }
    if (!best) return
    const info: DraftInfo = {
      name: best.record.name,
      savedAt: best.record.savedAt,
      baseEtag: best.record.baseEtag,
      older: best.key !== current,
    }
    const choice = await opts.prompt(info)
    if (choice === 'discard') {
      await deleteScope(s, grant.scope)
      return
    }
    if (choice !== 'restore') return
    await opts.host.restore(best.bytes, info)
    // the restored edits now belong to the version open now: keep one copy under its key
    if (best.key !== current) {
      const { iv, ciphertext } = await encryptDraft(grant.key, current, best.bytes)
      await s.put(current, { ...best.record, iv, ciphertext, baseEtag: file.etag ?? '' })
    }
    await deleteScope(s, grant.scope, current)
  }

  const timer = setInterval(() => void enqueue(write), opts.intervalMs ?? DRAFT_INTERVAL_MS)
  const onPageHide = () => void enqueue(write)
  target?.addEventListener('pagehide', onPageHide)

  return {
    opened: async () => {
      await enqueue(offer)
    },
    saved: async () => {
      await enqueue(async () => {
        const grant = opts.recovery()
        const s = getStore()
        if (grant && s) await deleteScope(s, grant.scope)
      })
    },
    flush: async () => {
      await enqueue(write)
    },
    dispose() {
      disposed = true
      clearInterval(timer)
      target?.removeEventListener('pagehide', onPageHide)
    },
  }
}
