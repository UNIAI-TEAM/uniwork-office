import { bindingJson, parseBinding, type Binding } from '../../uniwork-docs/binding-store'
import { isStoreSegment } from '../keys'
import type { SyncStoreAccess } from '../session-store'
import { APP_STORE_LEVEL } from '../store-level'
import type { StoreRecords, StoreRegistration, StoreWriteResult } from '../store'

/**
 * Parked working copies (G5-11): when an account signs out or switches away,
 * each dirty working copy whose N+1 bytes are not already captured in `intents`
 * is encrypted into one record per `documentKey` (full binding.json value +
 * bytes + timestamp) before the plaintext working-copy folder is removed. On
 * same-account sign-in the caller restores each parked copy atomically, checks
 * its sha256, and removes the parked record.
 */

export const PARKED_STORE_REGISTRATION: StoreRegistration = {
  name: 'parked',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

export interface ParkedCopy {
  documentKey: string
  /** full binding.json value */
  binding: Binding
  bytes: Uint8Array
  parkedAt: string
}

export type ParkedWriteResult = 'ok' | 'store_full' | 'keystore_locked' | 'interrupted'

export interface ParkedStore {
  /** one record per documentKey, atomic */
  park(copy: ParkedCopy): Promise<ParkedWriteResult>
  /** document keys */
  list(): Promise<string[]>
  /** read; caller deletes after the restore is durable */
  take(documentKey: string): Promise<ParkedCopy | null>
  remove(documentKey: string): Promise<void>
}

const META_LENGTH_BYTES = 4

const isStr = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** `<meta length BE><meta JSON><bytes>`: one document, one atomic record */
function encodeParkedCopy(copy: ParkedCopy): Uint8Array {
  const meta = Buffer.from(
    JSON.stringify({
      v: 1,
      documentKey: copy.documentKey,
      parkedAt: copy.parkedAt,
      binding: bindingJson(copy.binding),
    }),
    'utf8',
  )
  const out = Buffer.alloc(META_LENGTH_BYTES + meta.length + copy.bytes.length)
  out.writeUInt32BE(meta.length, 0)
  meta.copy(out, META_LENGTH_BYTES)
  out.set(copy.bytes, META_LENGTH_BYTES + meta.length)
  return out
}

function parseParkedBinding(raw: unknown): Binding | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const rawLevel =
    typeof r.min_store_level === 'number'
      ? r.min_store_level
      : typeof r.minStoreLevel === 'number'
        ? r.minStoreLevel
        : null
  if (rawLevel === null || !Number.isSafeInteger(rawLevel) || rawLevel < 1) return null
  const rawAppVersion =
    typeof r.min_app_version === 'string'
      ? r.min_app_version
      : typeof r.minAppVersion === 'string'
        ? r.minAppVersion
        : ''
  // The store layer's record header gate already verified `min_store_level`
  // against the layer's storeLevel; normalize to APP_STORE_LEVEL for field
  // parsing and preserve the binding's own minStoreLevel.
  const parsed = parseBinding({
    ...r,
    schema: 2,
    min_store_level: APP_STORE_LEVEL,
    min_app_version: rawAppVersion,
  })
  if (!parsed) return null
  return { ...parsed, minStoreLevel: rawLevel }
}

function decodeParkedCopy(bytes: Uint8Array): ParkedCopy | null {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buf.length < META_LENGTH_BYTES) return null
  const metaLength = buf.readUInt32BE(0)
  if (metaLength === 0 || buf.length < META_LENGTH_BYTES + metaLength) return null
  let raw: unknown
  try {
    raw = JSON.parse(
      buf.subarray(META_LENGTH_BYTES, META_LENGTH_BYTES + metaLength).toString('utf8'),
    )
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (!isStr(record.documentKey) || !isStoreSegment(record.documentKey)) return null
  if (!isStr(record.parkedAt)) return null
  const binding = parseParkedBinding(record.binding)
  if (!binding) return null
  return {
    documentKey: record.documentKey,
    binding,
    bytes: new Uint8Array(buf.subarray(META_LENGTH_BYTES + metaLength)),
    parkedAt: record.parkedAt,
  }
}

export function createParkedStore(
  source: StoreRecords | Pick<SyncStoreAccess, 'open'>,
): ParkedStore {
  const knownKeys = new Set<string>()

  const resolveRecords = async (): Promise<
    { kind: 'ok'; records: StoreRecords } | { kind: 'keystore_locked' }
  > => {
    if ('write' in source) return { kind: 'ok', records: source }
    const open = await source.open()
    if (open.kind !== 'ok') return { kind: 'keystore_locked' }
    return { kind: 'ok', records: open.records(PARKED_STORE_REGISTRATION.name) }
  }

  return {
    async park(copy) {
      if (!isStoreSegment(copy.documentKey) || !isStr(copy.parkedAt)) {
        throw new Error('invalid parked copy')
      }
      const resolved = await resolveRecords()
      if (resolved.kind !== 'ok') return 'keystore_locked'
      const written: StoreWriteResult = await resolved.records.write(
        copy.documentKey,
        encodeParkedCopy(copy),
      )
      if (written.kind === 'ok') {
        knownKeys.add(copy.documentKey)
        return 'ok'
      }
      if (written.kind === 'store_full') return 'store_full'
      if (written.kind === 'interrupted') return 'interrupted'
      return 'keystore_locked'
    },

    async list() {
      const resolved = await resolveRecords()
      if (resolved.kind !== 'ok') return []
      if (resolved.records.values) {
        const values = await resolved.records.values()
        const keys = new Set<string>()
        for (const raw of values) {
          const decoded = decodeParkedCopy(raw)
          if (decoded) keys.add(decoded.documentKey)
        }
        return [...keys].sort()
      }
      const keys: string[] = []
      for (const key of [...knownKeys].sort()) {
        const read = await resolved.records.read(key)
        if (read.kind === 'ok' && decodeParkedCopy(read.value)) keys.push(key)
      }
      return keys
    },

    async take(documentKey) {
      if (!isStoreSegment(documentKey)) return null
      const resolved = await resolveRecords()
      if (resolved.kind !== 'ok') return null
      const read = await resolved.records.read(documentKey)
      if (read.kind !== 'ok') return null
      const decoded = decodeParkedCopy(read.value)
      if (!decoded || decoded.documentKey !== documentKey) return null
      return decoded
    },

    async remove(documentKey) {
      if (!isStoreSegment(documentKey)) return
      knownKeys.delete(documentKey)
      const resolved = await resolveRecords()
      if (resolved.kind !== 'ok') return
      await resolved.records.delete(documentKey)
    },
  }
}
