import { APP_STORE_LEVEL } from './store-level'
import type { StoreRecords, StoreRegistration, StoreWriteResult } from './store'
import {
  parsePendingIntentRecord,
  readIntentRecord,
  type IntentBindFacts,
  type IntentRecordV2,
  type IntentRecordValue,
  type PendingIntentRecord,
} from './queue/record'

/**
 * The pending save intent, moved off the binding store into the durable store
 * layer. It keeps the shape the G5-04 callers know - `get` / `put` / `delete`
 * over one document key, one record per document, the exact payload bytes
 * beside the record - and serves the G5-06 v2 record (state, attempt,
 * generation, binding facts). A v1 record is read as a v2 one
 * (`readIntentRecord`): the binding facts the caller passes fill
 * orgId/workspaceId/baseVersion/length, `state` starts `queued`, `attempt` 0
 * and `generation` 1. A v1 `put` - only the G5-04 front writes those - keeps
 * the v1 record, because that call site has no binding facts: the upgrade is
 * stored by the next v2 write, and read paths with facts see the real binding
 * either way. A v2 `put` (the queue's own) is validated and stored as v2.
 *
 * `list()` is what a startup replay needs: an intent index record (a key with
 * `/`, which no working-copy document key can be) names the documents that
 * hold an intent, so the queue is enumerated without scanning drafts.
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
 * What the one-argument `get` returns: the G5-04 view of the record. What
 * comes back is always the v2 record (a v1 one is upgraded on the way out) -
 * the v2 fields are there at runtime - but a G5-04 caller only ever reads the
 * fields it already knew.
 */
export interface PendingIntentValue {
  intent: PendingIntentRecord
  payload: Uint8Array
}

export interface IntentListEntry {
  documentKey: string
  /** v1 records read here carry no binding facts (orgId/workspaceId '' and baseVersion 0) */
  intent: IntentRecordV2
}

export interface IntentStore {
  /** the intent of a document, or null when there is none to act on */
  get(documentKey: string): Promise<PendingIntentValue | null>
  /** the same record, v2, with the binding facts an upgraded v1 record needs */
  get(documentKey: string, facts: IntentBindFacts): Promise<IntentRecordValue | null>
  put(
    documentKey: string,
    intent: IntentRecordV2 | PendingIntentRecord,
    payload: Uint8Array,
    facts?: IntentBindFacts,
  ): Promise<StoreWriteResult>
  /** a locked scope has already wiped the intent: delete is then a no-op */
  delete(documentKey: string): Promise<void>
  /** every stored intent, enumerated by the index record (no draft scan) */
  list(): Promise<IntentListEntry[]>
}

const META_LENGTH_BYTES = 4
/** a document key is a working-copy folder segment, so it cannot contain '/' */
const INDEX_KEY = 'intents/index'

/** a v1 record read (or written) without binding facts */
const NO_FACTS: IntentBindFacts = { orgId: '', workspaceId: '', baseVersion: 0, length: 0 }

const isV2Record = (value: IntentRecordV2 | PendingIntentRecord): value is IntentRecordV2 =>
  (value as { v?: unknown }).v === 2

function encodeIndex(keys: string[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(keys))
}

async function readIndexKeys(records: StoreRecords): Promise<string[]> {
  const read = await records.read(INDEX_KEY)
  if (read.kind !== 'ok') return []
  try {
    const raw = JSON.parse(new TextDecoder().decode(read.value)) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((key): key is string => typeof key === 'string' && key.length > 0)
  } catch {
    return []
  }
}

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

function decodeValue(bytes: Uint8Array, facts?: IntentBindFacts): IntentRecordValue | null {
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
  const payload = new Uint8Array(buf.subarray(META_LENGTH_BYTES + metaLength))
  const intent = readIntentRecord(raw, facts ?? { ...NO_FACTS, length: payload.length })
  if (!intent) return null
  return { intent, payload }
}

export function createIntentStore(records: StoreRecords): IntentStore {
  /** index reads and writes are serialized, so two puts cannot lose a key */
  let indexChain: Promise<unknown> = Promise.resolve()
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const next = indexChain.then(run, run)
    indexChain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const get = async (
    documentKey: string,
    facts?: IntentBindFacts,
  ): Promise<IntentRecordValue | null> => {
    const read = await records.read(documentKey)
    // missing, refused (a newer build's record), corrupt, or interrupted: no
    // intent to act on, and nothing is deleted here
    if (read.kind !== 'ok') return null
    return decodeValue(read.value, facts)
  }

  return {
    get,

    async put(documentKey, intent, payload, facts) {
      // a v1 record from a G5-04 caller is written as it is: the binding facts
      // an upgrade needs are not available at this call site, so a later read
      // with real facts (the G5-06 front has them) upgrades it correctly. A
      // v2 write - the queue's own - is validated and stored as v2.
      const legacy = isV2Record(intent) ? null : parsePendingIntentRecord(intent)
      const record =
        legacy ??
        readIntentRecord(intent, {
          orgId: facts?.orgId ?? '',
          workspaceId: facts?.workspaceId ?? '',
          baseVersion: facts?.baseVersion ?? 0,
          length: facts?.length ?? payload.length,
        })
      if (!record) throw new Error('invalid save intent')
      const bytes = encodeValue(record, payload)
      // the index first: an intent the index does not name would be invisible
      // to list(), while a stale key for a record that never landed is skipped
      return serialize(async () => {
        const keys = await readIndexKeys(records)
        if (!keys.includes(documentKey)) {
          const indexed = await records.write(INDEX_KEY, encodeIndex([...keys, documentKey]))
          if (indexed.kind !== 'ok') return indexed
        }
        return records.write(documentKey, bytes)
      })
    },

    async delete(documentKey) {
      await records.delete(documentKey)
      await serialize(async () => {
        const keys = await readIndexKeys(records)
        if (!keys.includes(documentKey)) return
        await records.write(INDEX_KEY, encodeIndex(keys.filter((key) => key !== documentKey)))
      })
    },

    async list() {
      const keys = await readIndexKeys(records)
      const entries: IntentListEntry[] = []
      for (const key of keys) {
        // a key whose record is gone (a crash between the index and the write,
        // or a completed cleanup) is not an intent
        const value = await get(key)
        if (value) entries.push({ documentKey: key, intent: value.intent })
      }
      return entries
    },
  }
}
