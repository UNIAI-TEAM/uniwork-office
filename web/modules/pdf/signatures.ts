/**
 * Saved signatures on the web (GO-B4 / UNI-1014, capability `savedSignatures`).
 *
 * The desktop keeps the list in userData/pdf-signatures.json (main/signature-store.ts), private to
 * the OS user. The frame is same-origin with the UniWork app and its storage is shared by every
 * user of the browser profile, so the list is never stored as plaintext and never user-agnostic:
 *   - with the host's recovery grant (`init.recovery`) the whole list is one AES-GCM record in the
 *     frame's IndexedDB database (store `signatures`, key = the user part of the grant's scope,
 *     additional data = that key), encrypted with the host's per-user key. Another user cannot
 *     read it (other key) and the host's sign-out deletes the database with it;
 *   - without a grant the list lives in memory for this page load only.
 * The pre-fix build wrote plaintext into localStorage (LEGACY_KEY): the first call deletes it, and
 * adopts its entries into the encrypted store when a grant exists. Same validation, cap and dedupe
 * as the desktop (shared/signature-list.ts).
 */
import type { SavedSignature, SignatureData } from '../../../apps/pdf/src/shared/ipc'
import {
  MAX_SAVED_SIGNATURES,
  addSignature,
  isSignatureData,
  removeSignature,
  sanitizeSignatures,
} from '../../../apps/pdf/src/shared/signature-list'
import { decryptDraft, encryptDraft } from '../../docs/bridge/draft-recovery'
import { STORE_SIGNATURES, settle, userOfScope, withStore } from '../../docs/bridge/frame-idb'
import type { InitRecovery } from '../../docs/protocol/types'

/** the plaintext, user-agnostic key of the first build: only ever read to migrate and delete */
export const LEGACY_SIGNATURES_KEY = 'uniwork.office.pdf.savedSignatures'

interface SignatureRecord {
  iv: Uint8Array<ArrayBuffer>
  ciphertext: ArrayBuffer
  savedAt: number
}

export interface SignatureStoreOptions {
  /** the host's grant, read at every call (undefined = no persistence, memory only) */
  recovery?: () => InitRecovery | undefined
  /** resolves once the host's `init` (and so the grant) is known; default: already known */
  ready?: () => Promise<unknown>
  /** default: IndexedDB of this window */
  idb?: () => IDBFactory | null
  /** where the legacy plaintext list lived (default: window.localStorage) */
  legacy?: () => Storage | null
}

const utf8 = (s: string) => new TextEncoder().encode(s)

function defaultIdb(): IDBFactory | null {
  return typeof indexedDB === 'undefined' ? null : indexedDB
}

function defaultLegacy(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function createSignatureStore(opts: SignatureStoreOptions = {}) {
  const grant = opts.recovery ?? (() => undefined)
  const idb = opts.idb ?? defaultIdb
  const legacy = opts.legacy ?? defaultLegacy

  /** the list as loaded for one user scope ('' = no grant); reloaded when the scope changes */
  let loaded: { user: string; list: SavedSignature[] } | null = null
  let legacyHandled = false
  let queue: Promise<unknown> = Promise.resolve()

  /** one operation at a time: a read never sees half of a write */
  function serial<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job)
    queue = run.catch(() => undefined)
    return run
  }

  const recordKey = (user: string) => `signatures:${user}`

  async function readEncrypted(g: InitRecovery): Promise<SavedSignature[]> {
    const factory = idb()
    if (!factory) return []
    const user = userOfScope(g.scope)
    try {
      const record = await withStore(factory, STORE_SIGNATURES, 'readonly', (s) =>
        settle(s.get(user)),
      )
      if (!record) return []
      const r = record as SignatureRecord
      const bytes = await decryptDraft(g.key, recordKey(user), {
        iv: r.iv,
        ciphertext: r.ciphertext,
        baseEtag: '',
        savedAt: r.savedAt,
        module: 'pdf',
        name: '',
      })
      return bytes ? sanitizeSignatures(JSON.parse(new TextDecoder().decode(bytes))) : []
    } catch {
      return []
    }
  }

  /** false when it could not be persisted (the list then stays in memory for this page load) */
  async function writeEncrypted(g: InitRecovery, list: SavedSignature[]): Promise<boolean> {
    const factory = idb()
    if (!factory) return false
    const user = userOfScope(g.scope)
    try {
      const { iv, ciphertext } = await encryptDraft(
        g.key,
        recordKey(user),
        utf8(JSON.stringify(list)),
      )
      const record: SignatureRecord = { iv, ciphertext, savedAt: Date.now() }
      await withStore(factory, STORE_SIGNATURES, 'readwrite', (s) => settle(s.put(record, user)))
      return true
    } catch {
      return false
    }
  }

  /** read the plaintext list of the first build once and delete it, wherever it is */
  function takeLegacy(): SavedSignature[] {
    if (legacyHandled) return []
    legacyHandled = true
    try {
      const storage = legacy()
      const raw = storage?.getItem(LEGACY_SIGNATURES_KEY)
      if (!storage || raw === null || raw === undefined) return []
      storage.removeItem(LEGACY_SIGNATURES_KEY)
      return sanitizeSignatures(JSON.parse(raw))
    } catch {
      return []
    }
  }

  async function load(): Promise<SavedSignature[]> {
    await opts.ready?.().catch(() => undefined)
    const g = grant()
    const user = g ? userOfScope(g.scope) : ''
    if (loaded && loaded.user === user) return loaded.list
    let list: SavedSignature[] = []
    if (g) list = await readEncrypted(g)
    const old = takeLegacy()
    // adopt the old plaintext entries only into an encrypted store; without a grant they are dropped
    if (g && old.length > 0) {
      const fresh = old.filter((o) => !list.some((s) => s.id === o.id))
      list = [...list, ...fresh].slice(0, MAX_SAVED_SIGNATURES)
      await writeEncrypted(g, list)
    }
    loaded = { user, list }
    return list
  }

  async function commit(list: SavedSignature[]): Promise<SavedSignature[]> {
    const g = grant()
    loaded = { user: g ? userOfScope(g.scope) : '', list }
    if (g) await writeEncrypted(g, list)
    return list
  }

  return {
    list: () => serial(load),
    add: (data: SignatureData): Promise<SavedSignature[]> =>
      serial(async () => {
        const list = await load()
        return isSignatureData(data) ? commit(addSignature(list, data)) : list
      }),
    remove: (id: string): Promise<SavedSignature[]> =>
      serial(async () => {
        const list = await load()
        if (typeof id !== 'string') return list
        const next = removeSignature(list, id)
        return next.length === list.length ? list : commit(next)
      }),
  }
}
