import { createHash } from 'node:crypto'
import type { SyncStoreAccess } from './session-store'
import { APP_STORE_LEVEL } from './store-level'
import type { StoreRecords, StoreRegistration, StoreWriteResult } from './store'

/**
 * S01-R2-4 (UNI-1847): what survives a restart of a first Save to UniWork. The
 * first save leaves the ORIGINAL file plain on purpose and re-keys the tab to
 * the store copy, so the process-memory guard (`firstSaveDone`) is the only
 * thing that knows the original was saved - and a restart (or a crash between
 * the create and the bind) forgets it, letting a second Save create a twin.
 * One record per original path, written `pending` with the attempt's
 * Idempotency-Key BEFORE the create request and `bound` once the binding is
 * written; a post-create failure that archives the new document removes it.
 *
 * The record lives on the account's encrypted store layer like `upload-sessions`:
 * it is per account (never read for another owner), unreadable at rest, counted
 * by the budget and wiped with the account. A new store needs no store-level
 * bump: `schema: 1` at `APP_STORE_LEVEL` is what every other store in this
 * layer already writes, and no older build reads this namespace at all.
 */

export const FIRST_SAVES_STORE_REGISTRATION: StoreRegistration = {
  name: 'first-saves',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

export type FirstSaveState = 'pending' | 'bound'

/** one first save of one original path, exactly as it is persisted */
export interface FirstSaveRecord {
  idempotencyKey: string
  /** the attempt body: workspace, title, destination and the bytes' sha256 */
  fingerprint: string
  state: FirstSaveState
  /** set once `bound` */
  documentId?: string
  workingCopyPath?: string
  at: string
}

/**
 * The record key: the account plus the original file's path key. Hashed, so
 * the store never carries a path in a name.
 */
export function firstSaveKey(owner: string, pathKey: string): string {
  return createHash('sha256').update(`${owner}\u0000${pathKey}`, 'utf8').digest('hex')
}

export interface FirstSaveStore {
  /** the saved record of that key, or null when there is none (or it is unreadable) */
  get(key: string): Promise<FirstSaveRecord | null>
  put(key: string, record: FirstSaveRecord): Promise<StoreWriteResult>
  remove(key: string): Promise<void>
}

const isStr = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/**
 * One stored record, or null when it is not one this build can act on: a
 * record written by a newer build (a shape this reader does not know) is
 * dropped rather than guessed at - the first save then proceeds as a normal one.
 */
function decodeRecord(raw: unknown): FirstSaveRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (!isStr(record.idempotencyKey) || !isStr(record.fingerprint) || !isStr(record.at)) return null
  if (record.state !== 'pending' && record.state !== 'bound') return null
  if (record.state === 'bound' && !isStr(record.documentId)) return null
  return {
    idempotencyKey: record.idempotencyKey,
    fingerprint: record.fingerprint,
    state: record.state,
    ...(isStr(record.documentId) ? { documentId: record.documentId } : {}),
    ...(isStr(record.workingCopyPath) ? { workingCopyPath: record.workingCopyPath } : {}),
    at: record.at,
  }
}

export function createFirstSaveStore(
  source: StoreRecords | Pick<SyncStoreAccess, 'open'>,
): FirstSaveStore {
  const resolveRecords = async (): Promise<StoreRecords | null> => {
    if ('write' in source) return source
    const open = await source.open()
    return open.kind === 'ok' ? open.records(FIRST_SAVES_STORE_REGISTRATION.name) : null
  }

  return {
    async get(key) {
      const records = await resolveRecords()
      if (!records) return null
      const read = await records.read(key)
      if (read.kind !== 'ok') return null
      try {
        return decodeRecord(JSON.parse(Buffer.from(read.value).toString('utf8')))
      } catch {
        return null
      }
    },

    async put(key, record) {
      const records = await resolveRecords()
      if (!records) return { kind: 'refused' }
      return records.write(key, Buffer.from(JSON.stringify(record), 'utf8'))
    },

    async remove(key) {
      const records = await resolveRecords()
      if (!records) return
      await records.delete(key)
    },
  }
}
