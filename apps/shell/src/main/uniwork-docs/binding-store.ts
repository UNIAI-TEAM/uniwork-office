import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  UniworkDocAccess,
  UniworkDocErrorCode,
  UniworkDocFormat,
  UniworkSaveState,
} from '../../shared/home-api'
import { atomicWriteFile } from '../atomic-write'
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
  serverRevision?: string
  /** OQ-P4 (b): the store generation this copy needs (written as `min_store_level`) */
  minStoreLevel: number
  /** OQ-P4 (b): the build that wrote it, display only (written as `min_app_version`) */
  minAppVersion: string
  lastSavedAt?: string
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
const FORMATS: ReadonlySet<string> = new Set(['docx', 'xlsx', 'pptx', 'pdf', 'md', 'html'])
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
])

function segment(value: string): string {
  if (!SEGMENT.test(value) || value.includes('..')) throw new Error('invalid binding path segment')
  return value
}

function isStr(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
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
  const minStoreLevel = schema2 ? (r.min_store_level as number) : APP_STORE_LEVEL
  const minAppVersion = typeof r.min_app_version === 'string' ? r.min_app_version : ''
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
    ...(isDecimalString(r.serverRevision) ? { serverRevision: r.serverRevision } : {}),
    minStoreLevel,
    minAppVersion,
    ...(typeof r.lastSavedAt === 'string' ? { lastSavedAt: r.lastSavedAt } : {}),
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

export class BindingStore {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
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

  async write(dir: string, binding: Binding): Promise<void> {
    await mkdir(dir, { recursive: true })
    await atomicWriteFile(
      join(dir, BINDING_FILE),
      new TextEncoder().encode(`${JSON.stringify(bindingJson(binding), null, 2)}\n`),
    )
  }

  async writeWorkingCopy(dir: string, filename: string, bytes: Uint8Array): Promise<string> {
    await mkdir(dir, { recursive: true })
    const path = join(dir, basename(filename))
    await atomicWriteFile(path, bytes)
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

  async writeLastOwner(owner: LastOwner): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await atomicWriteFile(
      join(this.root, LAST_OWNER_FILE),
      new TextEncoder().encode(`${JSON.stringify(owner)}\n`),
    )
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
