import { CredentialStoreError } from '../../uniwork-auth/credentials'
import { isStoreSegment, type StoreScope } from '../keys'
import { APP_STORE_LEVEL } from '../store-level'
import type {
  OpenedStore,
  StoreKeyStatus,
  StoreLayer,
  StoreRecords,
  StoreRegistration,
} from '../store'
import { MAX_PIN_FILE_BYTES } from './manifest'
import { decodePinRecord, encodePinRecord, isGeneration, type PinRecord } from './record'

/**
 * Durable offline-library store (`offline-library`, schema 1, APP_STORE_LEVEL).
 *
 * Every pinned byte - the pin rows, the index and each file and asset - is a
 * record of the encrypted store layer, keyed by the account's
 * OS-keystore-wrapped key (Advisor rule: no plaintext copy anywhere, no temp
 * or staging file outside the store). The library has its OWN layer instance
 * (its own root, key and budget; lead decision on W5 "A"), so library bytes
 * never count against the sync store budget of queue + drafts.
 *
 * Result kinds follow the lease store: `keystore_locked`, `keyring_unavailable`
 * and `no_session` are reported as they are; `store_full` (the layer budget,
 * or a filesystem ENOSPC) writes nothing; a malformed record is `refused`.
 * `interrupted` means the scope was wiped under the call (sign-out).
 */

export const OFFLINE_LIBRARY_STORE_REGISTRATION: StoreRegistration = {
  name: 'offline-library',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

/** U-01: 2 GiB of pinned documents per account per machine */
export const OFFLINE_LIBRARY_QUOTA_BYTES = 2 * 1024 * 1024 * 1024
/** U-01: 200 pinned documents per account per machine */
export const OFFLINE_LIBRARY_MAX_PINS = 200
/**
 * The library layer's own budget: the 2 GiB quota (enforced by the manager
 * from manifest sizes), plus one 256 MiB staging copy so the largest file can
 * be re-downloaded beside its committed copy at the cap, plus 16 MiB for the
 * record frames, rows and index. Crossing it is `store_full`.
 */
export const OFFLINE_LIBRARY_LAYER_BUDGET_BYTES =
  OFFLINE_LIBRARY_QUOTA_BYTES + MAX_PIN_FILE_BYTES + 16 * 1024 * 1024

export const LIBRARY_INDEX_KEY = 'index'

export function pinKey(documentId: string): string {
  return `pin/${documentId}`
}

/** `blob/<id>/<generation>/main` or `blob/<id>/<generation>/asset/<n>` */
export function blobKey(documentId: string, generation: string, part: 'main' | number): string {
  return `blob/${documentId}/${generation}/${part === 'main' ? 'main' : `asset/${part}`}`
}

/** the store keys of one generation of a snapshot with `assetCount` assets */
export function generationKeys(
  documentId: string,
  generation: string,
  assetCount: number,
): string[] {
  const keys = [blobKey(documentId, generation, 'main')]
  for (let index = 0; index < assetCount; index += 1) {
    keys.push(blobKey(documentId, generation, index))
  }
  return keys
}

export interface LibraryIndex {
  /** pinned document ids, in pin order */
  pins: string[]
  /** unpinned while open: the keys still to delete once the last tab closes */
  cleanup: Record<string, string[]>
}

export type LibraryStoreUnavailable =
  | { kind: 'keystore_locked' }
  | { kind: 'keyring_unavailable' }
  | { kind: 'no_session' }
  | { kind: 'interrupted' }

export type LibraryWriteResult =
  { kind: 'ok' } | { kind: 'store_full' } | { kind: 'refused' } | LibraryStoreUnavailable

export type LibraryDeleteResult = { kind: 'ok' } | LibraryStoreUnavailable

export type PinReadResult =
  | { kind: 'ok'; record: PinRecord }
  | { kind: 'missing' }
  | { kind: 'refused' }
  | LibraryStoreUnavailable

export type IndexReadResult =
  { kind: 'ok'; index: LibraryIndex } | { kind: 'refused' } | LibraryStoreUnavailable

export type BlobReadResult =
  | { kind: 'ok'; bytes: Uint8Array }
  | { kind: 'missing' }
  | { kind: 'corrupt' }
  | { kind: 'refused' }
  | LibraryStoreUnavailable

export interface OfflineLibraryStore {
  readIndex(): Promise<IndexReadResult>
  writeIndex(index: LibraryIndex): Promise<LibraryWriteResult>
  getPin(documentId: string): Promise<PinReadResult>
  putPin(record: PinRecord): Promise<LibraryWriteResult>
  deletePin(documentId: string): Promise<LibraryDeleteResult>
  putBlob(key: string, bytes: Uint8Array): Promise<LibraryWriteResult>
  getBlob(key: string): Promise<BlobReadResult>
  deleteBlob(key: string): Promise<LibraryDeleteResult>
  /** drop the opened handle (account boundary): the next call opens the scope again */
  forget(): void
}

export type OfflineLibraryStoreSource =
  { layer: StoreLayer; scope: StoreScope | (() => StoreScope | null) } | StoreRecords

type Resolved = { kind: 'ok'; records: StoreRecords } | LibraryStoreUnavailable

const BLOB_KEY = /^blob\/([A-Za-z0-9_-]{1,128})\/([0-9a-f]{8,64})\/(main|asset\/\d{1,4})$/

/** a key this store would ever write as a blob */
export function isBlobKey(key: string): boolean {
  const match = BLOB_KEY.exec(key)
  return !!match && isStoreSegment(match[1]!) && isGeneration(match[2])
}

function isLayerSource(
  source: OfflineLibraryStoreSource,
): source is { layer: StoreLayer; scope: StoreScope | (() => StoreScope | null) } {
  return typeof (source as { layer?: unknown }).layer === 'object'
}

function readScope(scope: StoreScope | (() => StoreScope | null)): StoreScope | null {
  return typeof scope === 'function' ? scope() : scope
}

function isEnospc(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOSPC'
}

function parseIndex(bytes: Uint8Array): LibraryIndex | null {
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.pins) || r.pins.some((id) => typeof id !== 'string' || !isStoreSegment(id)))
    return null
  if (!r.cleanup || typeof r.cleanup !== 'object' || Array.isArray(r.cleanup)) return null
  const cleanup: Record<string, string[]> = {}
  for (const [documentId, keys] of Object.entries(r.cleanup as Record<string, unknown>)) {
    if (!isStoreSegment(documentId) || !Array.isArray(keys)) return null
    if (keys.some((key) => typeof key !== 'string' || !isBlobKey(key))) return null
    cleanup[documentId] = [...(keys as string[])]
  }
  return { pins: [...new Set(r.pins as string[])], cleanup }
}

export function createOfflineLibraryStore(source: OfflineLibraryStoreSource): OfflineLibraryStore {
  /**
   * The opened handle of the scope, kept: re-opening per call would scrub the
   * temp file of a write still in flight. The key is re-verified before every
   * use, so the handle never outlives a relocked keychain, and a handle the
   * wipe killed (interrupted) is dropped.
   */
  let opened: { token: string; store: OpenedStore } | null = null

  const unavailable = (status: Exclude<StoreKeyStatus, 'ok'>): LibraryStoreUnavailable => ({
    kind: status,
  })

  const resolve = async (): Promise<Resolved> => {
    if (!isLayerSource(source)) return { kind: 'ok', records: source }
    const scope = readScope(source.scope)
    if (!scope) return { kind: 'no_session' }
    const token = `${scope.deploymentId}/${scope.accountId}`
    try {
      const status = await source.layer.verifyKey(scope)
      if (status !== 'ok') return unavailable(status)
      if (!opened || opened.token !== token) {
        const result = await source.layer.open(scope)
        if (result.kind !== 'ok') return unavailable(result.kind)
        opened = { token, store: result.store }
      }
      return { kind: 'ok', records: opened.store.records(OFFLINE_LIBRARY_STORE_REGISTRATION.name) }
    } catch (error) {
      if (error instanceof CredentialStoreError) {
        return {
          kind: error.code === 'keyring_unavailable' ? 'keyring_unavailable' : 'keystore_locked',
        }
      }
      throw error
    }
  }

  const dropHandle = () => {
    opened = null
  }

  const write = async (key: string, value: Uint8Array): Promise<LibraryWriteResult> => {
    const resolved = await resolve()
    if (resolved.kind !== 'ok') return resolved
    let written
    try {
      written = await resolved.records.write(key, value)
    } catch (error) {
      // a full disk is the library's disk-full, never a crash
      if (isEnospc(error)) return { kind: 'store_full' }
      throw error
    }
    if (written.kind === 'interrupted') dropHandle()
    return written
  }

  const read = async (key: string) => {
    const resolved = await resolve()
    if (resolved.kind !== 'ok') return resolved
    const result = await resolved.records.read(key)
    if (result.kind === 'interrupted') dropHandle()
    return result
  }

  const remove = async (key: string): Promise<LibraryDeleteResult> => {
    const resolved = await resolve()
    if (resolved.kind !== 'ok') return resolved
    const result = await resolved.records.delete(key)
    if (result.kind === 'interrupted') dropHandle()
    return result
  }

  return {
    async readIndex() {
      const result = await read(LIBRARY_INDEX_KEY)
      if (result.kind === 'missing') return { kind: 'ok', index: { pins: [], cleanup: {} } }
      if (result.kind === 'corrupt') return { kind: 'refused' }
      if (result.kind !== 'ok') return result
      const index = parseIndex(result.value)
      return index ? { kind: 'ok', index } : { kind: 'refused' }
    },

    async writeIndex(index) {
      if (index.pins.some((id) => !isStoreSegment(id))) return { kind: 'refused' }
      return write(LIBRARY_INDEX_KEY, new TextEncoder().encode(JSON.stringify(index)))
    },

    async getPin(documentId) {
      if (!isStoreSegment(documentId)) return { kind: 'refused' }
      const result = await read(pinKey(documentId))
      if (result.kind === 'corrupt') return { kind: 'refused' }
      if (result.kind !== 'ok') return result
      const record = decodePinRecord(result.value)
      if (!record || record.documentId !== documentId) return { kind: 'refused' }
      return { kind: 'ok', record }
    },

    async putPin(record) {
      let encoded: Uint8Array
      try {
        encoded = encodePinRecord(record)
      } catch {
        return { kind: 'refused' }
      }
      return write(pinKey(record.documentId), encoded)
    },

    async deletePin(documentId) {
      if (!isStoreSegment(documentId)) return { kind: 'ok' }
      return remove(pinKey(documentId))
    },

    async putBlob(key, bytes) {
      if (!isBlobKey(key)) return { kind: 'refused' }
      return write(key, bytes)
    },

    async getBlob(key) {
      if (!isBlobKey(key)) return { kind: 'refused' }
      const result = await read(key)
      if (result.kind === 'ok') return { kind: 'ok', bytes: result.value }
      return result
    },

    async deleteBlob(key) {
      if (!isBlobKey(key)) return { kind: 'ok' }
      return remove(key)
    },

    forget: dropHandle,
  }
}
