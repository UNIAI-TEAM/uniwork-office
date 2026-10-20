import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  UniworkDocAccess,
  UniworkDocEditLock,
  UniworkDocErrorCode,
  UniworkDocFormat,
  UniworkSaveState,
} from '../../shared/home-api'
import { atomicCopyFile, atomicWriteFile } from '../atomic-write'
import { APP_STORE_LEVEL, readStoreGate } from '../uniwork-sync/store-level'
import { formatForName, isDecimalString } from './formats'

/**
 * Working copies of UniWork documents and their binding metadata:
 * `<root>/<deploymentId>/<userId>/<documentKey>/<filename>` with `binding.json`
 * next to it (written atomically). The binding is the only record that a
 * local path belongs to a UniWork document; a path outside the root, or one
 * whose folder holds no valid binding for that file name, is a plain local
 * file. No token, ticket or URL is ever written here.
 */

export const BINDING_FILE = 'binding.json'
/**
 * The bytes of a pending save intent as pre-store builds kept them, beside
 * the binding. This build never writes one (the intent lives in the durable
 * store); the schema 1 -> 2 migration reads and deletes the leftovers.
 */
export const INTENT_PAYLOAD_FILE = 'pending-upload.bin'
/** at the root: who last had a live session (see readLastOwner) */
export const LAST_OWNER_FILE = 'last-account.json'

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
// a flush that a cloud-sync folder, AV lock or fsync-less filesystem refuses only weakens
// power-loss durability (same policy as atomic-write.ts)
const TOLERATED_SYNC_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EINVAL', 'ENOSYS'])
const RENAME_RETRIES = 4
// the owner write is synchronous on the main thread: 5+10+20+40 ms worst case, not atomic-write's 750 ms
const RENAME_BACKOFF_MS = 5

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export interface LastOwner {
  accountId: string
  deploymentId: string
}

export interface Binding {
  /** the schema this build reads and writes; schema 1 is upgraded on the next write */
  schema: 2
  documentId: string
  workspaceId: string
  orgId: string
  title: string
  filename: string
  format: UniworkDocFormat
  access: UniworkDocAccess
  baseRevision: string
  baseVersion: number
  baseChecksum: string
  state: UniworkSaveState
  error?: UniworkDocErrorCode
  /** EL-1(a) (UNI-1645c): populated while `state === 'edit_locked'`; absent otherwise */
  editLock?: UniworkDocEditLock
  /** Payload size in bytes when `error === 'too_large'`. */
  sizeBytes?: number
  /** Maximum allowed document size in bytes when `error === 'too_large'`. */
  maxBytes?: number
  serverRevision?: string
  /**
   * G5-03a: the server's head version when it differs from this copy's base
   * (a caught notice); the S6 bar of kind newer-* is rebuilt from this and
   * `serverRevision` after a restart, because the feed cursor does not replay
   * the notice. Absent = no known newer version.
   */
  serverVersion?: number
  /** OQ-P4 (b): the store generation this copy needs (written as `min_store_level`) */
  minStoreLevel: number
  /** OQ-P4 (b): the build that wrote it, display only (written as `min_app_version`) */
  minAppVersion: string
  lastSavedAt?: string
  /**
   * G8-12: the server version id of the base bytes (the comments anchor base),
   * from the document read at open or the last commit receipt; absent while
   * unknown. Moves with `baseVersion`, never on its own.
   */
  baseVersionId?: string
  /** G8-12: the caller's effective level (`my_level`) last read from the server */
  level?: UniworkDocLevel
  /** UNI-1961: true while the document is shelved in Archive (Lưu trữ); forces read-only without altering `level` */
  shelved?: true
}

export type UniworkDocLevel = 'view' | 'comment' | 'edit' | 'manage'

/** a server `my_level` this build knows, else undefined */
export function docLevelOf(value: unknown): UniworkDocLevel | undefined {
  return value === 'view' || value === 'comment' || value === 'edit' || value === 'manage'
    ? value
    : undefined
}

/**
 * Is this working copy editable by its caller? Edit access, and a level that is unread (older
 * binding) or edit-or-better. A level below edit (`view`, `comment`) or a word this build does not
 * know never rides on a stale `edit` access, so nothing here reads an unknown level upward.
 */
export function bindingCanEdit(binding: Pick<Binding, 'access' | 'level' | 'shelved'>): boolean {
  if (binding.shelved || binding.access !== 'edit') return false
  const level: unknown = binding.level
  return level === undefined || level === 'edit' || level === 'manage'
}

export interface BoundDocument {
  /** the working copy */
  path: string
  /** the folder holding the working copy and binding.json */
  dir: string
  deploymentId: string
  userId: string
  /** the document key: the working-copy folder segment (a version copy has its own) */
  key: string
  binding: Binding
}

/**
 * How this build reads a binding.json value, without parsing it: `current` is
 * a store this build reads (schema 1 - the legacy form - and schema 2 whose
 * `min_store_level` is inside this build's window), `newer` a store it must
 * not read (schema >= 3, or a schema-2 `min_store_level` missing, malformed or
 * above this build: the G5-04g S11 lock), `unrecognized` anything else (no or
 * garbage schema, non-JSON).
 */
export type BindingKind = 'current' | 'newer' | 'unrecognized'

/**
 * OQ-P4 (b): what this build does with the store the binding declares. Schema
 * 1 is this app's own legacy form and opens; schema 2 needs a safe-integer
 * `min_store_level` in 1..APP_STORE_LEVEL; schema >= 3 belongs to a newer app,
 * as does a malformed schema-2 level (the G5-04g rule). `min_app_version` is
 * never a gate: it is read for display only.
 */
export function bindingKindOf(raw: unknown): BindingKind {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'unrecognized'
  const schema = (raw as Record<string, unknown>).schema
  if (typeof schema !== 'number' || !Number.isSafeInteger(schema)) return 'unrecognized'
  if (schema === 1) return 'current'
  if (schema >= 2) return readStoreGate(raw) === 'open' ? 'current' : 'newer'
  return 'unrecognized'
}

/** how `BindingStore.classify` reads a path: one binding.json read, three outcomes */
export type PathBinding =
  | { kind: 'newer'; path: string; name: string }
  | { kind: 'bound'; doc: BoundDocument }
  | { kind: 'plain' }

/** a working copy whose folder declares a store this build does not read */
export interface NewerStore {
  /** the working copy, or its folder when the working-copy name is not known yet */
  path: string
  /** basename of the working copy (the binding is not parsed, so no title) */
  name: string
}

/** how the binding.json of `dir` reads; null when there is none or it is unreadable */
export function bindingKindAt(dir: string): BindingKind | null {
  try {
    return bindingKindOf(JSON.parse(readFileSync(join(dir, BINDING_FILE), 'utf8')))
  } catch {
    return null
  }
}

/** the document file name a folder's lock shows: the first in sorted order, so it is deterministic */
export function documentNameIn(dir: string): string {
  let name = basename(dir)
  try {
    name =
      readdirSync(dir)
        .sort()
        .find((entry) => formatForName(entry) !== null) ?? name
  } catch {
    // unreadable folder: the folder's own name is all there is
  }
  return name
}

/**
 * The working-copy folders of one account boundary:
 * `<root>/<deploymentId>/<accountId>/<documentKey>/...`. The migration walks
 * them; anything unreadable is skipped rather than failing the walk.
 */
export function scopeWorkingCopyDirs(
  root: string,
  scope: { deploymentId: string; accountId: string },
): string[] {
  const scopeDir = join(resolve(root), scope.deploymentId, scope.accountId)
  try {
    return readdirSync(scopeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(scopeDir, entry.name))
  } catch {
    return []
  }
}

/**
 * True while `dir` still holds a pre-store pending upload: a schema-1
 * binding.json that carries a `pendingIntent` plus the `pending-upload.bin`
 * bytes beside it. Only the schema 1 -> 2 migration (and the S11 lock while
 * the store cannot open) cares about either file.
 */
export function hasLegacyIntentFiles(dir: string): boolean {
  if (!existsSync(join(dir, INTENT_PAYLOAD_FILE))) return false
  try {
    const raw = JSON.parse(readFileSync(join(dir, BINDING_FILE), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') return false
    const r = raw as Record<string, unknown>
    return r.schema === 1 && r.pendingIntent !== undefined
  } catch {
    return false
  }
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/
const FORMATS: ReadonlySet<string> = new Set(['docx', 'xlsx', 'pptx', 'pdf', 'md', 'txt', 'html'])
const STATES: ReadonlySet<string> = new Set([
  'ready',
  'dirty',
  'saving',
  'saved',
  'conflict',
  'blocked',
  'offline',
  'signed-out',
  'error',
  // G5-06 durable save queue: the chip states an intent's record maps onto
  // (see save-coordinator's queueBindingPatch). They are written to the binding
  // so a restart reads the same chip, and must read back like any other state.
  'queued',
  'paused_offline',
  'paused_user',
  'paused_admin',
  'reconciling',
  'reconciling-stuck',
  'failed',
  'edit_locked',
])

function segment(value: string): string {
  if (!SEGMENT.test(value) || value.includes('..')) throw new Error('invalid binding path segment')
  return value
}

function isStr(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseEditLock(raw: unknown): UniworkDocEditLock | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const strOrNull = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : null
  const offlineHoldUntil = strOrNull(r.offlineHoldUntil, 64)
  return {
    holderName: strOrNull(r.holderName, 256),
    since: strOrNull(r.since, 64),
    expiresAt: strOrNull(r.expiresAt, 64),
    heldByMe: r.heldByMe === true,
    ...(offlineHoldUntil ? { offlineHoldUntil } : {}),
  }
}

/**
 * A binding read back from disk, normalized to what this build writes: a
 * schema-1 value reads as its schema-2 form (the next write stamps it), and a
 * schema-2 value is read only when the store gate opens (`newer` values never
 * reach here). null for anything not exactly one of those schemas.
 */
export function parseBinding(raw: unknown): Binding | null {
  if (bindingKindOf(raw) !== 'current') return null
  const r = raw as Record<string, unknown>
  const schema2 = r.schema === 2
  if (!isStr(r.documentId) || !isStr(r.workspaceId) || !isStr(r.title) || !isStr(r.filename))
    return null
  if (typeof r.orgId !== 'string') return null
  if (!isStr(r.format) || !FORMATS.has(r.format)) return null
  if (r.access !== 'edit' && r.access !== 'view') return null
  if (!isDecimalString(r.baseRevision) || typeof r.baseChecksum !== 'string') return null
  if (typeof r.baseVersion !== 'number' || !Number.isSafeInteger(r.baseVersion)) return null
  if (!isStr(r.state) || !STATES.has(r.state)) return null
  if (r.serverRevision !== undefined && !isDecimalString(r.serverRevision)) return null
  if (
    r.serverVersion !== undefined &&
    (typeof r.serverVersion !== 'number' ||
      !Number.isSafeInteger(r.serverVersion) ||
      r.serverVersion < 0)
  ) {
    return null
  }
  const minStoreLevel = schema2 ? (r.min_store_level as number) : APP_STORE_LEVEL
  const minAppVersion = typeof r.min_app_version === 'string' ? r.min_app_version : ''
  const editLock = r.state === 'edit_locked' ? parseEditLock(r.editLock) : undefined
  return {
    schema: 2,
    documentId: r.documentId,
    workspaceId: r.workspaceId,
    orgId: r.orgId,
    title: r.title,
    filename: r.filename,
    format: r.format as UniworkDocFormat,
    access: r.access,
    baseRevision: r.baseRevision,
    baseVersion: r.baseVersion,
    baseChecksum: r.baseChecksum,
    // a save cannot still be running after a restart: its intent is replayed
    // from the durable store, so nothing is kept here
    state: r.state === 'saving' ? 'dirty' : (r.state as UniworkSaveState),
    ...(typeof r.error === 'string' ? { error: r.error as UniworkDocErrorCode } : {}),
    ...(editLock ? { editLock } : {}),
    ...(typeof r.sizeBytes === 'number' && Number.isSafeInteger(r.sizeBytes) && r.sizeBytes >= 0
      ? { sizeBytes: r.sizeBytes }
      : {}),
    ...(typeof r.maxBytes === 'number' && Number.isSafeInteger(r.maxBytes) && r.maxBytes > 0
      ? { maxBytes: r.maxBytes }
      : {}),
    ...(isDecimalString(r.serverRevision) ? { serverRevision: r.serverRevision } : {}),
    ...(typeof r.serverVersion === 'number' ? { serverVersion: r.serverVersion } : {}),
    minStoreLevel,
    minAppVersion,
    ...(typeof r.lastSavedAt === 'string' ? { lastSavedAt: r.lastSavedAt } : {}),
    ...(typeof r.baseVersionId === 'string' &&
    r.baseVersionId.length > 0 &&
    r.baseVersionId.length <= 128
      ? { baseVersionId: r.baseVersionId }
      : {}),
    ...(docLevelOf(r.level) ? { level: docLevelOf(r.level) } : {}),
    ...(r.shelved === true ? { shelved: true } : {}),
  }
}

/**
 * The binding.json value of a binding: schema 2 with `min_store_level` and
 * `min_app_version` (the OQ-P4 field names the reader gate looks at).
 */
export function bindingJson(binding: Binding): Record<string, unknown> {
  const { minStoreLevel, minAppVersion, ...rest } = binding
  return {
    ...rest,
    schema: 2,
    min_store_level: minStoreLevel,
    min_app_version: minAppVersion,
  }
}

/**
 * True while the binding.json of `dir` must not be rewritten: the schema 1 -> 2
 * sweep still owns that working copy, and a rewrite would stamp schema 2 and
 * drop `pendingIntent` - the only replayable record of the pre-store save while
 * `pending-upload.bin` holds its bytes. Injected by the service (the one choke
 * point every binding rewrite goes through); the sweep itself writes with
 * atomicWriteFile, so its own guard never refuses it.
 */
export type BindingWriteHold = (dir: string) => boolean

export class BindingStore {
  readonly root: string
  private readonly holdWrite: BindingWriteHold

  constructor(root: string, holdWrite: BindingWriteHold = () => false) {
    this.root = resolve(root)
    this.holdWrite = holdWrite
  }

  /** the working-copy folder of one document (historical versions get their own key) */
  dirFor(deploymentId: string, userId: string, documentKey: string): string {
    return join(this.root, segment(deploymentId), segment(userId), segment(documentKey))
  }

  /**
   * The bound document a path belongs to, or null. Synchronous: the module
   * policy (isBound / isReadOnly) asks during open and save.
   */
  lookup(path: string): BoundDocument | null {
    const full = resolve(path)
    const rel = relative(this.root, full)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
    const parts = rel.split(sep)
    if (parts.length !== 4) return null
    const [deploymentId, userId, key, filename] = parts as [string, string, string, string]
    if (![deploymentId, userId, key].every((part) => SEGMENT.test(part))) return null
    const dir = dirname(full)
    let binding: Binding | null
    try {
      binding = parseBinding(JSON.parse(readFileSync(join(dir, BINDING_FILE), 'utf8')))
    } catch {
      return null
    }
    if (!binding || binding.filename !== filename) return null
    return { path: full, dir, deploymentId, userId, key, binding }
  }

  /** the working-copy folder of `path` and its three segments, or null when the path is not one of ours */
  private workingCopy(path: string): { dir: string; parts: string[] } | null {
    const full = resolve(path)
    const rel = relative(this.root, full)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
    const parts = rel.split(sep)
    if (parts.length !== 4) return null
    if (!parts.slice(0, 3).every((part) => SEGMENT.test(part))) return null
    return { dir: dirname(full), parts }
  }

  /**
   * How this build reads the binding of the working copy `path` names, in ONE
   * read of its binding.json. The module policy asks per open tab every second
   * (isBound / isReadOnly), so classifying and then parsing must not cost two
   * reads of the same file. `newer` is a store this build does not read,
   * `bound` a schema-1 document of this file name, `plain` everything else
   * (outside the root, not a working-copy folder, no or unreadable binding, a
   * binding for another file name).
   */
  classify(path: string): PathBinding {
    const found = this.workingCopy(path)
    if (!found) return { kind: 'plain' }
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(join(found.dir, BINDING_FILE), 'utf8'))
    } catch {
      return { kind: 'plain' }
    }
    const full = resolve(path)
    if (bindingKindOf(raw) === 'newer') {
      return { kind: 'newer', path: full, name: basename(full) }
    }
    const binding = parseBinding(raw)
    if (!binding || binding.filename !== basename(full)) return { kind: 'plain' }
    const [deploymentId, userId, key] = found.parts as [string, string, string, string]
    return {
      kind: 'bound',
      doc: { path: full, dir: found.dir, deploymentId, userId, key, binding },
    }
  }

  /**
   * The lock for a path whose folder holds an integer schema >= 2 binding.json:
   * this build does not read that store, so the working copy is neither opened
   * nor treated as a plain local file. null for anything else (outside the
   * root, schema 1, no or unreadable binding).
   */
  newerStoreAt(path: string): NewerStore | null {
    const found = this.classify(path)
    return found.kind === 'newer' ? { path: found.path, name: found.name } : null
  }

  /**
   * The same from the folder alone, for the routes that know the folder before
   * the file name (a launch ticket). The folder's document file names the lock
   * (the first in sorted order, so the name is deterministic); a folder with
   * none (or an unreadable one) is named by the folder itself.
   */
  newerStoreIn(dir: string): NewerStore | null {
    if (bindingKindAt(dir) !== 'newer') return null
    const name = documentNameIn(dir)
    return { path: join(dir, name), name }
  }

  /**
   * True while the working copy at `path` still holds a pre-store pending
   * upload (a schema-1 binding.json with a pendingIntent and its
   * pending-upload.bin). The store-backed save never writes either file; until
   * the schema 1 -> 2 migration moved the intent, opening such a copy needs the
   * durable store, so a locked one is refused with the S11 `keystore_locked`.
   */
  legacyIntentAt(path: string): boolean {
    const found = this.workingCopy(path)
    return found !== null && hasLegacyIntentFiles(found.dir)
  }

  /** the binding of a document folder (any working-copy name), or null */
  async readDir(dir: string): Promise<Binding | null> {
    try {
      return parseBinding(JSON.parse(await readFile(join(dir, BINDING_FILE), 'utf8')))
    } catch {
      return null
    }
  }

  /**
   * Writes the binding atomically. Resolves `false`, writing nothing, while
   * `holdWrite` says the schema 1 -> 2 sweep still owns this folder: every
   * binding rewrite - save, status refresh, open, conflict flow - goes through
   * here, so no caller can drop a `pendingIntent` the sweep has not moved yet.
   * `true` once the write landed (a resolve without a throw is still a write).
   */
  async write(dir: string, binding: Binding): Promise<boolean> {
    if (this.holdWrite(dir)) return false
    await mkdir(dir, { recursive: true })
    await atomicWriteFile(
      join(dir, BINDING_FILE),
      new TextEncoder().encode(`${JSON.stringify(bindingJson(binding), null, 2)}\n`),
    )
    return true
  }

  async writeWorkingCopy(dir: string, filename: string, bytes: Uint8Array): Promise<string> {
    await mkdir(dir, { recursive: true })
    const path = join(dir, basename(filename))
    await atomicWriteFile(path, bytes)
    return path
  }

  /**
   * BIGUP-A1: the same working copy, taken from a file on disk instead of from
   * bytes main holds. A first save of a 200 MiB document never buffers it, so
   * the copy is streamed (`atomicCopyFile` copies to a temp file and renames,
   * exactly like `atomicWriteFile` does for a buffer).
   */
  async copyIntoWorkingCopy(dir: string, filename: string, source: string): Promise<string> {
    await mkdir(dir, { recursive: true })
    const path = join(dir, basename(filename))
    await atomicCopyFile(source, path)
    return path
  }

  async removeWorkingCopy(dir: string, filename: string): Promise<void> {
    await unlink(join(dir, basename(filename))).catch(() => undefined)
  }

  async readIntentPayload(dir: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(join(dir, INTENT_PAYLOAD_FILE)))
    } catch {
      return null
    }
  }

  async dropIntentPayload(dir: string): Promise<void> {
    await unlink(join(dir, INTENT_PAYLOAD_FILE)).catch(() => undefined)
  }

  /**
   * The account + deployment that last had a live session here. Their copies
   * stay editable (saved locally) while the session is gone or restoring; a
   * live session of anyone else makes them read-only. Ids only, no token.
   */
  readLastOwner(): LastOwner | null {
    try {
      const raw = JSON.parse(readFileSync(join(this.root, LAST_OWNER_FILE), 'utf8')) as unknown
      if (!raw || typeof raw !== 'object') return null
      const { accountId, deploymentId } = raw as Record<string, unknown>
      if (typeof accountId !== 'string' || !SEGMENT.test(accountId)) return null
      if (typeof deploymentId !== 'string' || !SEGMENT.test(deploymentId)) return null
      return { accountId, deploymentId }
    } catch {
      return null
    }
  }

  /**
   * Synchronous on purpose (no late write after teardown). It keeps the
   * guarantees of the async atomicWriteFile it replaced: the file is flushed
   * before the rename, a transient Windows rename error is retried a bounded
   * number of times, the directory is flushed after the rename (not on
   * Windows) and a failure leaves the previous file intact with no temp file.
   * Returns whether the owner reached the disk, so the caller can retry.
   */
  writeLastOwner(owner: LastOwner): boolean {
    const target = join(this.root, LAST_OWNER_FILE)
    const tmp = join(this.root, `.${LAST_OWNER_FILE}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      mkdirSync(this.root, { recursive: true })
      const fd = openSync(tmp, 'w')
      try {
        // writeSync may accept fewer bytes than asked: publish only a complete record
        const data = Buffer.from(
          `${JSON.stringify(owner)}
`,
          'utf8',
        )
        for (let offset = 0; offset < data.byteLength;) {
          const written = writeSync(fd, data, offset, data.byteLength - offset)
          if (written <= 0) throw new Error('last owner write made no progress')
          offset += written
        }
        try {
          fsyncSync(fd)
        } catch (error) {
          if (!TOLERATED_SYNC_CODES.has((error as NodeJS.ErrnoException).code ?? '')) throw error
        }
      } finally {
        closeSync(fd)
      }
      for (let attempt = 0; ; attempt += 1) {
        try {
          renameSync(tmp, target)
          break
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code ?? ''
          if (!RETRYABLE_RENAME_CODES.has(code) || attempt >= RENAME_RETRIES) throw error
          sleepSync(RENAME_BACKOFF_MS * 2 ** attempt)
        }
      }
      // the rename is only durable once the directory entry is flushed; opening a
      // directory fails on Windows, where NTFS journals the rename itself
      if (process.platform !== 'win32') {
        try {
          const dirFd = openSync(this.root, 'r')
          try {
            fsyncSync(dirFd)
          } finally {
            closeSync(dirFd)
          }
        } catch {
          // a refused directory flush only weakens power-loss durability
        }
      }
      return true
    } catch {
      try {
        unlinkSync(tmp)
      } catch {
        // ignore cleanup failure
      }
      return false
    }
  }

  /** the path lies under the working-copy root (bound or not) */
  isInside(path: string): boolean {
    const rel = relative(this.root, resolve(path))
    return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
  }

  exists(path: string): boolean {
    return existsSync(path)
  }
}
