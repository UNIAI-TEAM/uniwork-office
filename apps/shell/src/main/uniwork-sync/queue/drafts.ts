import { APP_STORE_LEVEL } from '../store-level'
import type { StoreRecords, StoreRegistration, StoreWriteResult } from '../store'
import { QUEUE_LIMITS } from './limits'

/**
 * The kept-draft store: the snapshot of an intent the user cancelled, threw
 * away or superseded becomes a "Nháp đã giữ" row (EXPERIENCE › Queue rows).
 * It is a registered store of the G5-04 layer like `intents`, so it lives
 * encrypted, budgeted and wiped at the account boundary.
 *
 * Drafts are stored per document - one record holding the document's drafts -
 * so the cap of `draftsPerDocument` is enforced without a scan: the store is
 * only read when a document's drafts are listed or changed, never at startup.
 */

export const DRAFTS_STORE_REGISTRATION: StoreRegistration = {
  name: 'drafts',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

export type DraftKeepResult = 'ok' | 'drafts_full' | 'store_full' | 'keystore_locked'

export interface KeptDraftMeta {
  /** unique within a document's kept drafts */
  id: string
  /** when the snapshot was taken (ISO) */
  createdAt: string
  /** what the row shows (the element name / working-copy basename) */
  title?: string
}

export interface KeptDraft extends KeptDraftMeta {
  /** the exact snapshot bytes the cancelled intent would have uploaded */
  snapshot: Uint8Array
}

export interface DraftStore {
  /** keep one snapshot of `documentKey`; the 4th draft is refused `drafts_full` */
  keep(documentKey: string, snapshot: Uint8Array, meta: KeptDraftMeta): Promise<DraftKeepResult>
  list(documentKey: string): Promise<KeptDraft[]>
  /**
   * B34/R1-2 (UNI-1362): whether at least one draft is kept for `documentKey`,
   * with the store's own status preserved: `unavailable` is a record this build
   * cannot read right now (refused/interrupted), which `list` reports as `[]`.
   * A caller deciding "is there local work to keep" must treat `unavailable` as
   * "cannot prove there is none", never as an empty list.
   */
  has(documentKey: string): Promise<boolean | 'unavailable'>
  remove(documentKey: string, id: string): Promise<void>
}

interface DraftsManifestEntry {
  id: string
  createdAt: string
  title?: string
  offset: number
  length: number
}

/** `<meta length BE><meta JSON><snapshots>`: one document, one atomic write */
function encodeDrafts(drafts: KeptDraft[]): Uint8Array {
  let total = 0
  const entries: DraftsManifestEntry[] = drafts.map((draft) => {
    const entry: DraftsManifestEntry = {
      id: draft.id,
      createdAt: draft.createdAt,
      ...(draft.title === undefined ? {} : { title: draft.title }),
      offset: total,
      length: draft.snapshot.length,
    }
    total += draft.snapshot.length
    return entry
  })
  const meta = Buffer.from(JSON.stringify({ v: 1, drafts: entries }), 'utf8')
  const out = Buffer.alloc(4 + meta.length + total)
  out.writeUInt32BE(meta.length, 0)
  meta.copy(out, 4)
  let at = 4 + meta.length
  for (const draft of drafts) {
    out.set(draft.snapshot, at)
    at += draft.snapshot.length
  }
  return out
}

const isStr = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function decodeDrafts(bytes: Uint8Array): KeptDraft[] {
  const parsed = parseDraftsRecord(bytes)
  if (!parsed) return []
  return parsed.entries.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    ...(entry.title === undefined ? {} : { title: entry.title }),
    snapshot: new Uint8Array(parsed.payload.subarray(entry.offset, entry.offset + entry.length)),
  }))
}

/**
 * The manifest of a record plus the byte range the snapshots live in, or null
 * when the bytes are not one of ours. The snapshots themselves are not copied:
 * a presence check only needs the entries.
 */
function parseDraftsRecord(
  bytes: Uint8Array,
): { entries: DraftsManifestEntry[]; payload: Buffer } | null {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buf.length < 4) return null
  const metaLength = buf.readUInt32BE(0)
  if (metaLength === 0 || buf.length < 4 + metaLength) return null
  let raw: unknown
  try {
    raw = JSON.parse(buf.subarray(4, 4 + metaLength).toString('utf8'))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!('drafts' in raw)) return null
  const drafts = raw.drafts
  if (!Array.isArray(drafts)) return null
  const payload = buf.subarray(4 + metaLength)
  const entries: DraftsManifestEntry[] = []
  for (const item of drafts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const entry = item as Record<string, unknown>
    if (!isStr(entry.id) || !isStr(entry.createdAt)) return null
    if (!isOffset(entry.offset) || !isOffset(entry.length)) return null
    if (entry.offset + entry.length > payload.length) return null
    entries.push({
      id: entry.id,
      createdAt: entry.createdAt,
      ...(isStr(entry.title) ? { title: entry.title } : {}),
      offset: entry.offset,
      length: entry.length,
    })
  }
  return { entries, payload }
}

/** `unavailable`: the record exists but this build cannot serve it right now */
type DraftRead = { kind: 'ok'; drafts: KeptDraft[] } | { kind: 'unavailable' }

export function createDraftStore(records: StoreRecords): DraftStore {
  const read = async (documentKey: string): Promise<DraftRead> => {
    const result = await records.read(documentKey)
    // missing or corrupt: nothing this build can act on (like the intent store)
    if (result.kind === 'missing' || result.kind === 'corrupt') return { kind: 'ok', drafts: [] }
    if (result.kind !== 'ok') return { kind: 'unavailable' }
    return { kind: 'ok', drafts: decodeDrafts(result.value) }
  }

  return {
    async keep(documentKey, snapshot, meta) {
      const current = await read(documentKey)
      // a record the account boundary wiped, or a newer build's record: the
      // draft cannot be kept now, retry after unlock
      if (current.kind === 'unavailable') return 'keystore_locked'
      const others = current.drafts.filter((draft) => draft.id !== meta.id)
      if (others.length >= QUEUE_LIMITS.draftsPerDocument) return 'drafts_full'
      const written: StoreWriteResult = await records.write(
        documentKey,
        encodeDrafts([...others, { ...meta, snapshot }]),
      )
      if (written.kind === 'ok') return 'ok'
      if (written.kind === 'store_full') return 'store_full'
      // `interrupted` (the scope locked/wiped under the write) and `refused`
      // are not budget problems: nothing was kept and a retry can still work
      if (written.kind === 'interrupted') return 'keystore_locked'
      return 'store_full'
    },

    async list(documentKey) {
      const current = await read(documentKey)
      return current.kind === 'ok' ? current.drafts : []
    },

    async has(documentKey) {
      const result = await records.read(documentKey)
      // missing or corrupt: nothing this build can act on, so no draft to keep
      if (result.kind === 'missing' || result.kind === 'corrupt') return false
      // refused (a newer build's record), interrupted (the scope locked or was
      // wiped under the read): the draft cannot be ruled out
      if (result.kind !== 'ok') return 'unavailable'
      return (parseDraftsRecord(result.value)?.entries.length ?? 0) > 0
    },

    async remove(documentKey, id) {
      const current = await read(documentKey)
      if (current.kind !== 'ok') return
      const next = current.drafts.filter((draft) => draft.id !== id)
      if (next.length === current.drafts.length) return
      await records.write(documentKey, encodeDrafts(next))
    },
  }
}
