import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  UniworkDocAccess,
  UniworkDocErrorCode,
  UniworkDocFormat,
  UniworkSaveState,
} from '../../shared/home-api'
import { atomicWriteFile } from '../atomic-write'
import { isDecimalString } from './formats'

/**
 * Working copies of UniWork documents and their binding metadata:
 * `<root>/<deploymentId>/<userId>/<documentKey>/<filename>` with `binding.json`
 * next to it (written atomically). The binding is the only record that a
 * local path belongs to a UniWork document; a path outside the root, or one
 * whose folder holds no valid binding for that file name, is a plain local
 * file. No token, ticket or URL is ever written here.
 */

export const BINDING_FILE = 'binding.json'
/** the bytes of a pending save intent, kept so a replay sends the same payload */
export const INTENT_PAYLOAD_FILE = 'pending-upload.bin'
/** at the root: who last had a live session (see readLastOwner) */
export const LAST_OWNER_FILE = 'last-account.json'

export interface LastOwner {
  accountId: string
  deploymentId: string
}

export interface PendingIntent {
  intentId: string
  idempotencyKey: string
  documentId: string
  /** decimal string */
  baseRevision: string
  /** sha256 hex of the payload bytes */
  checksum: string
  createdAt: string
}

export interface Binding {
  schema: 1
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
  pendingIntent?: PendingIntent
  lastSavedAt?: string
}

export interface BoundDocument {
  /** the working copy */
  path: string
  /** the folder holding the working copy and binding.json */
  dir: string
  deploymentId: string
  userId: string
  binding: Binding
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

function parseIntent(raw: unknown): PendingIntent | undefined | null {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (
    !isStr(r.intentId) ||
    !isStr(r.idempotencyKey) ||
    !isStr(r.documentId) ||
    !isDecimalString(r.baseRevision) ||
    !isStr(r.checksum) ||
    !isStr(r.createdAt)
  ) {
    return null
  }
  return {
    intentId: r.intentId,
    idempotencyKey: r.idempotencyKey,
    documentId: r.documentId,
    baseRevision: r.baseRevision,
    checksum: r.checksum,
    createdAt: r.createdAt,
  }
}

/** a binding read back from disk; null for anything not exactly this schema */
export function parseBinding(raw: unknown): Binding | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.schema !== 1) return null
  if (!isStr(r.documentId) || !isStr(r.workspaceId) || !isStr(r.title) || !isStr(r.filename))
    return null
  if (typeof r.orgId !== 'string') return null
  if (!isStr(r.format) || !FORMATS.has(r.format)) return null
  if (r.access !== 'edit' && r.access !== 'view') return null
  if (!isDecimalString(r.baseRevision) || typeof r.baseChecksum !== 'string') return null
  if (typeof r.baseVersion !== 'number' || !Number.isSafeInteger(r.baseVersion)) return null
  if (!isStr(r.state) || !STATES.has(r.state)) return null
  const intent = parseIntent(r.pendingIntent)
  if (intent === null) return null
  if (r.serverRevision !== undefined && !isDecimalString(r.serverRevision)) return null
  return {
    schema: 1,
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
    // a save cannot still be running after a restart: it is retried from its intent
    state: r.state === 'saving' ? (intent ? 'offline' : 'dirty') : (r.state as UniworkSaveState),
    ...(typeof r.error === 'string' ? { error: r.error as UniworkDocErrorCode } : {}),
    ...(isDecimalString(r.serverRevision) ? { serverRevision: r.serverRevision } : {}),
    ...(intent ? { pendingIntent: intent } : {}),
    ...(typeof r.lastSavedAt === 'string' ? { lastSavedAt: r.lastSavedAt } : {}),
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
    return { path: full, dir, deploymentId, userId, binding }
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
      new TextEncoder().encode(`${JSON.stringify(binding, null, 2)}\n`),
    )
  }

  async writeWorkingCopy(dir: string, filename: string, bytes: Uint8Array): Promise<string> {
    await mkdir(dir, { recursive: true })
    const path = join(dir, basename(filename))
    await atomicWriteFile(path, bytes)
    return path
  }

  async writeIntentPayload(dir: string, bytes: Uint8Array): Promise<void> {
    await atomicWriteFile(join(dir, INTENT_PAYLOAD_FILE), bytes)
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
