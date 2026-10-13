import { APP_STORE_LEVEL } from './store-level'
import type { StoreRecords, StoreRegistration, StoreWriteResult } from './store'
import {
  isIntentRecordV2,
  parsePendingIntentRecord,
  parseStoredIntent,
  readIntentRecord,
  upgradePendingIntent,
  type IntentBindFacts,
  type IntentRecordV2,
  type IntentRecordValue,
  type PendingIntentRecord,
} from './queue/record'

/**
 * The pending save intent, moved off the binding store into the durable store
 * layer. It keeps the shape the G5-04 callers know - `get` / `put` / `delete`
 * over one document key, one record per document, the exact payload bytes
 * beside the record. `get` returns the record as it is stored (a v1 record the
 * G5-04 front wrote stays v1). The queue reads v2 through `read`, which
 * upgrades a v1 record with the binding facts the caller has: orgId,
 * workspaceId, baseVersion and length, with `state: 'queued'`, `attempt: 0`
 * and `generation: 1`. `put` validates and stores a v2 record, and keeps
 * writing v1 when a G5-04 caller passes one (that call site has no facts to
 * upgrade with; `read` applies them instead).
 *
 * The layout is deliberately one record per document: the G5-04 migration
 * sweep pins exactly one record under the `intents` store (a resumed run
 * overwrites the same key), so no index record is added here.
 */

export const INTENT_STORE_REGISTRATION: StoreRegistration = {
  name: 'intents',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

export type { IntentBindFacts, IntentRecordV2, IntentRecordValue, PendingIntentRecord }
/** the G5-04 name of the v1 parser (the migration sweep uses it) */
export { parsePendingIntentRecord as parseIntentRecord }

/**
 * What `get` returns: the G5-04 view of the record. A v2 record has all of
 * these fields and is served as it is; a v1 record is served verbatim.
 */
export interface PendingIntentValue {
  intent: PendingIntentRecord
  payload: Uint8Array
}

export interface IntentStore {
  /** the stored intent of a document, or null when there is none to act on */
  get(documentKey: string): Promise<PendingIntentValue | null>
  /** the same record as a v2 one, upgrading a v1 record with the binding facts */
  read(documentKey: string, facts: IntentBindFacts): Promise<IntentRecordValue | null>
  put(
    documentKey: string,
    intent: IntentRecordV2 | PendingIntentRecord,
    payload: Uint8Array,
  ): Promise<StoreWriteResult>
  /** a locked scope has already wiped the intent: delete is then a no-op */
  delete(documentKey: string): Promise<void>
}

const META_LENGTH_BYTES = 4

/** the binding facts a v2 write carries itself (they are never used from here) */
const NO_FACTS: IntentBindFacts = { orgId: '', workspaceId: '', baseVersion: 0, length: 0 }

/** `<meta length BE><meta JSON><payload>`: one record, so one atomic write */
function encodeValue(
  intent: IntentRecordV2 | PendingIntentRecord,
  payload: Uint8Array,
): Uint8Array {
  const meta = Buffer.from(JSON.stringify(intent), 'utf8')
  const out = Buffer.alloc(META_LENGTH_BYTES + meta.length + payload.length)
  out.writeUInt32BE(meta.length, 0)
  meta.copy(out, META_LENGTH_BYTES)
  out.set(payload, META_LENGTH_BYTES + meta.length)
  return out
}

interface DecodedIntentValue {
  intent: IntentRecordV2 | PendingIntentRecord
  payload: Uint8Array
}

function decodeParts(bytes: Uint8Array): { raw: unknown; payload: Uint8Array } | null {
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
  return { raw, payload: new Uint8Array(buf.subarray(META_LENGTH_BYTES + metaLength)) }
}

export function createIntentStore(records: StoreRecords): IntentStore {
  /** the record as it is stored: v2 verbatim, v1 verbatim, anything else null */
  const stored = async (documentKey: string): Promise<DecodedIntentValue | null> => {
    const read = await records.read(documentKey)
    // missing, refused (a newer build's record), corrupt, or interrupted: no
    // intent to act on, and nothing is deleted here
    if (read.kind !== 'ok') return null
    const parts = decodeParts(read.value)
    if (!parts) return null
    const intent = parseStoredIntent(parts.raw)
    if (!intent) return null
    return { intent, payload: parts.payload }
  }

  return {
    get: stored,

    async read(documentKey, facts) {
      const value = await stored(documentKey)
      if (!value) return null
      const intent = isIntentRecordV2(value.intent)
        ? value.intent
        : upgradePendingIntent(value.intent, facts)
      return { intent, payload: value.payload }
    },

    async put(documentKey, intent, payload) {
      // a v1 record from a G5-04 caller is written as it is: this call site has
      // no binding facts, so the upgrade is applied by `read` and stored by the
      // next v2 write. A v2 write - the queue's own - is validated and stored.
      const record = isIntentRecordV2(intent)
        ? readIntentRecord(intent, NO_FACTS)
        : parsePendingIntentRecord(intent)
      if (!record) throw new Error('invalid save intent')
      return records.write(documentKey, encodeValue(record, payload))
    },

    async delete(documentKey) {
      await records.delete(documentKey)
    },
  }
}
