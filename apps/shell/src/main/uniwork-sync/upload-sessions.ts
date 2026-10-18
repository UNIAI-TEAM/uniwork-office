import { createHash } from 'node:crypto'
import type { SyncStoreAccess } from './session-store'
import { APP_STORE_LEVEL } from './store-level'
import type { StoreRecords, StoreRegistration, StoreWriteResult } from './store'

/**
 * BIGUP-A1 (UNI-1864): the resume store of the new-document chunked upload.
 * `uploadDocument` opens an upload session for a file above the server's
 * threshold; the session id and the parts already stored are persisted here so
 * a restart (or a re-pick of the same, unchanged file) resumes with the
 * remaining parts instead of re-sending 200 MiB. One record per
 * `sha256("<path>:<size>:<mtimeMs>")`, so a file the person edited in between
 * gets a different key and therefore a fresh session - never a session whose
 * probe describes other bytes.
 *
 * The record lives on the account's encrypted store layer like `intents` and
 * `drafts`: nothing about a path or a session is readable at rest, the account
 * budget counts it, and a sign-out wipes it. A new store needs no store-level
 * bump: `schema: 1` at `APP_STORE_LEVEL` is what every other store in this
 * layer already writes, and no older build reads this namespace at all.
 */

export const UPLOAD_SESSIONS_STORE_REGISTRATION: StoreRegistration = {
  name: 'upload-sessions',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

export interface UploadSessionPart {
  partNumber: number
  etag: string
}

/** one resumable session, exactly as it is persisted */
export interface UploadSessionRecord {
  sessionId: string
  workspaceId: string
  /** the folder the document will be created in; null = the caller's My Folder */
  folderId: string | null
  /**
   * R1-BE-03: the rest of the create fingerprint - the title, file name and
   * visibility the session was opened with. A saved session may only be resumed
   * when ALL of them still match the new command, so a re-pick of the same
   * unchanged file for another folder, or a first save retried under another
   * title, aborts the old session instead of finishing the old command.
   * Optional because a record written before this build has none (it then
   * cannot be proven to match, so it is not resumed).
   */
  title?: string
  filename?: string
  visibility?: string | null
  path: string
  size: number
  mtimeMs: number
  partSize: number
  totalParts: number
  completedParts: UploadSessionPart[]
  expiresAt: string
  updatedAt: string
}

/**
 * The record key: the same file, byte for byte and unmodified since, names the
 * same key. `mtimeMs` is in the hash because a re-pick of an edited file must
 * not resume a session whose probe described the older bytes.
 */
export function uploadSessionKey(path: string, size: number, mtimeMs: number): string {
  return createHash('sha256').update(`${path}:${size}:${mtimeMs}`, 'utf8').digest('hex')
}

export interface UploadSessionStore {
  /** the saved session of that key, or null when there is none to resume */
  get(key: string): Promise<UploadSessionRecord | null>
  put(key: string, record: UploadSessionRecord): Promise<StoreWriteResult>
  /** a session that finished or was cancelled leaves nothing behind */
  remove(key: string): Promise<void>
}

const isStr = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** every part, in order, or null: a record with one bad row is not resumable */
function readParts(raw: unknown): UploadSessionPart[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const parts: UploadSessionPart[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    if (!isCount(row.partNumber) || row.partNumber < 1 || !isStr(row.etag)) return null
    parts.push({ partNumber: row.partNumber, etag: row.etag })
  }
  return parts
}

/**
 * One stored record, or null when it is not one this build can resume from: a
 * record written by a newer build (a shape this reader does not know) is
 * dropped rather than guessed at - the upload then starts a fresh session,
 * which is always correct.
 */
function decodeRecord(raw: unknown): UploadSessionRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (!isStr(record.sessionId) || !isStr(record.workspaceId) || !isStr(record.path)) return null
  if (record.folderId !== null && record.folderId !== undefined && !isStr(record.folderId)) {
    return null
  }
  if (!isCount(record.size) || !isCount(record.partSize) || !isCount(record.totalParts)) return null
  if (record.partSize <= 0 || record.totalParts <= 0) return null
  if (typeof record.mtimeMs !== 'number' || !Number.isFinite(record.mtimeMs)) return null
  const parts = readParts(record.completedParts)
  if (!parts) return null
  if (!isStr(record.expiresAt) || !isStr(record.updatedAt)) return null
  return {
    sessionId: record.sessionId,
    workspaceId: record.workspaceId,
    folderId: typeof record.folderId === 'string' ? record.folderId : null,
    ...(isStr(record.title) ? { title: record.title } : {}),
    ...(isStr(record.filename) ? { filename: record.filename } : {}),
    ...(typeof record.visibility === 'string'
      ? { visibility: record.visibility }
      : record.visibility === null
        ? { visibility: null }
        : {}),
    path: record.path,
    size: record.size,
    mtimeMs: record.mtimeMs,
    partSize: record.partSize,
    totalParts: record.totalParts,
    completedParts: parts,
    expiresAt: record.expiresAt,
    updatedAt: record.updatedAt,
  }
}

export function createUploadSessionStore(
  source: StoreRecords | Pick<SyncStoreAccess, 'open'>,
): UploadSessionStore {
  const resolveRecords = async (): Promise<
    { kind: 'ok'; records: StoreRecords } | { kind: 'keystore_locked' }
  > => {
    if ('write' in source) return { kind: 'ok', records: source }
    const open = await source.open()
    if (open.kind !== 'ok') return { kind: 'keystore_locked' }
    return { kind: 'ok', records: open.records(UPLOAD_SESSIONS_STORE_REGISTRATION.name) }
  }

  return {
    async get(key) {
      const resolved = await resolveRecords()
      if (resolved.kind !== 'ok') return null
      const read = await resolved.records.read(key)
      if (read.kind !== 'ok') return null
      try {
        return decodeRecord(JSON.parse(Buffer.from(read.value).toString('utf8')))
      } catch {
        return null
      }
    },

    async put(key, record) {
      const resolved = await resolveRecords()
      if (resolved.kind !== 'ok') return { kind: 'refused' }
      return resolved.records.write(key, Buffer.from(JSON.stringify(record), 'utf8'))
    },

    async remove(key) {
      const resolved = await resolveRecords()
      if (resolved.kind !== 'ok') return
      await resolved.records.delete(key)
    },
  }
}
