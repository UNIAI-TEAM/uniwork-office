import { isDecimalString } from '../uniwork-docs/formats'
import { APP_STORE_LEVEL } from './store-level'
import type { StoreRecords, StoreRegistration, StoreWriteResult } from './store'

/**
 * The pending save intent, moved off the binding store into the durable store
 * layer. It keeps the same fields as the `pendingIntent` the binding used to
 * carry, plus the exact payload bytes (what `pending-upload.bin` used to
 * hold), and now sits behind the encryption, budget and lock/wipe rules of a
 * registered store.
 */

export interface PendingIntentRecord {
  intentId: string
  idempotencyKey: string
  documentId: string
  /** decimal string */
  baseRevision: string
  /** sha256 hex of the payload bytes */
  checksum: string
  createdAt: string
}

export interface PendingIntentValue {
  intent: PendingIntentRecord
  /** the exact bytes the intent uploads */
  payload: Uint8Array
}

export const INTENT_STORE_REGISTRATION: StoreRegistration = {
  name: 'intents',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

export interface IntentStore {
  /** the pending intent of a document, or null when there is none to act on */
  get(documentKey: string): Promise<PendingIntentValue | null>
  put(
    documentKey: string,
    intent: PendingIntentRecord,
    payload: Uint8Array,
  ): Promise<StoreWriteResult>
  /** a locked scope has already wiped the intent: delete is then a no-op */
  delete(documentKey: string): Promise<void>
}

const META_LENGTH_BYTES = 4

function isStr(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** the same shape check the binding store applied to its pendingIntent */
export function parseIntentRecord(raw: unknown): PendingIntentRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isStr(r.intentId) || !isStr(r.idempotencyKey) || !isStr(r.documentId)) return null
  if (!isDecimalString(r.baseRevision)) return null
  if (!isStr(r.checksum) || !isStr(r.createdAt)) return null
  return {
    intentId: r.intentId,
    idempotencyKey: r.idempotencyKey,
    documentId: r.documentId,
    baseRevision: r.baseRevision,
    checksum: r.checksum,
    createdAt: r.createdAt,
  }
}

/** `<meta length BE><meta JSON><payload>`: one record, so one atomic write */
function encodeValue(intent: PendingIntentRecord, payload: Uint8Array): Uint8Array {
  const meta = Buffer.from(JSON.stringify(intent), 'utf8')
  const out = Buffer.alloc(META_LENGTH_BYTES + meta.length + payload.length)
  out.writeUInt32BE(meta.length, 0)
  meta.copy(out, META_LENGTH_BYTES)
  out.set(payload, META_LENGTH_BYTES + meta.length)
  return out
}

function decodeValue(bytes: Uint8Array): PendingIntentValue | null {
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
  const intent = parseIntentRecord(raw)
  if (!intent) return null
  return { intent, payload: new Uint8Array(buf.subarray(META_LENGTH_BYTES + metaLength)) }
}

export function createIntentStore(records: StoreRecords): IntentStore {
  return {
    async get(documentKey) {
      const read = await records.read(documentKey)
      // missing, refused (a newer build's record), corrupt, or interrupted: no
      // intent to act on, and nothing is deleted here
      if (read.kind !== 'ok') return null
      return decodeValue(read.value)
    },

    async put(documentKey, intent, payload) {
      const parsed = parseIntentRecord(intent)
      if (!parsed) throw new Error('invalid pending intent')
      return records.write(documentKey, encodeValue(parsed, payload))
    },

    async delete(documentKey) {
      await records.delete(documentKey)
    },
  }
}
