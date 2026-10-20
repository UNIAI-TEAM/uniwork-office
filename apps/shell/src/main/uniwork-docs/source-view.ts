import { createHash, randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathKey } from '../../shared/path-key'
import type {
  OpenSourceInput,
  OpenSourceValue,
  SourceViewErrorCode,
  SourceViewResult,
  SourceViewState,
} from '../../shared/source-view'
import type { UniworkModuleSeam } from './modules'

/*
 * UNI-1993 (UW-SOURCE-RO): a Workspace source file (attached in chat, a task, a
 * meeting or email) opens as a view-only tab. It is NOT a UniWork document: no
 * document id, no binding, no queue, no sync. The bytes land in a temp file
 * under the draft-preview root (so every recents guard that already skips
 * previews skips this too), and this registry is the one place the six editor
 * modules learn that the path is view-only: it is merged into the module seam
 * that already carries bound / read-only / locked. The service never sees it.
 *
 * Electron-free: the shell injects the client call, the open router and the
 * session facts, so the whole path runs under a plain test.
 */

/** the one-line truth for a path: which source it shows, for the tab chip */
export class SourceViewRegistry {
  private readonly entries = new Map<string, { path: string; meta: SourceViewState }>()

  add(path: string, meta: SourceViewState): void {
    if (typeof path !== 'string' || path === '') throw new Error('source view path required')
    this.entries.set(pathKey(path), { path, meta: { ...meta } })
  }

  has(path: string): boolean {
    return typeof path === 'string' && path !== '' && this.entries.has(pathKey(path))
  }

  meta(path: string): SourceViewState | null {
    if (typeof path !== 'string' || path === '') return null
    const found = this.entries.get(pathKey(path))
    return found ? { ...found.meta } : null
  }

  remove(path: string): boolean {
    if (typeof path !== 'string' || path === '') return false
    return this.entries.delete(pathKey(path))
  }

  /** every registered path as it was added (the shell closes these tabs at an account boundary) */
  paths(): string[] {
    return [...this.entries.values()].map((entry) => entry.path)
  }
}

export interface SourceViewSeamOptions {
  /** an explicit Save on a source view: the shell shows the "view only" hint (writes nothing) */
  onSourceSave?(path: string): void
}

/** what `installUniworkModuleSeams` takes to merge the registry into the module seam */
export interface SourceViewBinding extends SourceViewSeamOptions {
  registry: SourceViewRegistry
}

/**
 * The module seam with the source views merged in. A registered path reads as
 * bound (no autosave, no recovery), read-only (editing locked, AI limited to
 * read tools) and locked (Save As, export and print refused, as on the web);
 * every other path is the service's answer unchanged. The wrapped service is
 * not modified, so its own bound/read-only/locked verdicts never include a source.
 */
export function withSourceViews(
  seam: UniworkModuleSeam,
  registry: SourceViewRegistry,
  options: SourceViewSeamOptions = {},
): UniworkModuleSeam {
  const wrapped: UniworkModuleSeam = {
    isBound: (path) => registry.has(path) || seam.isBound(path),
    isReadOnly: (path) => registry.has(path) || seam.isReadOnly(path),
    isLocked: (path) => registry.has(path) || seam.isLocked?.(path) === true,
    consumeCapture: (path) => (registry.has(path) ? false : seam.consumeCapture?.(path) === true),
    // a source is never saved, so it never reaches the UniWork user-save pipeline
    onUserSave: (path) => {
      if (!registry.has(path)) seam.onUserSave(path)
    },
    onReadOnlySave: (path) => {
      if (registry.has(path)) options.onSourceSave?.(path)
      else seam.onReadOnlySave?.(path)
    },
    refuseLockedPath: (path) => (registry.has(path) ? false : seam.refuseLockedPath(path)),
  }
  if (seam.setClearRecovery) wrapped.setClearRecovery = (clear) => seam.setClearRecovery?.(clear)
  if (seam.setClearOriginals) {
    wrapped.setClearOriginals = (clear) => seam.setClearOriginals?.(clear)
  }
  return wrapped
}

/** a closed source tab keeps its temp file this long (the shell has no close event for a path) */
export const SOURCE_VIEW_CLOSE_GRACE_MS = 30_000

/** the extensions the editor modules read: docx, xlsx, pptx, pdf, markdown (md, markdown, txt), html (html, htm) */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'md',
  'markdown',
  'html',
  'htm',
  'txt',
])

const MAX_FILE_NAME = 120
const MAX_META_TEXT = 200
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** the injected file operations; defaults are node's, tests inject faults */
export interface SourceViewFs {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  rm(path: string, options: { recursive: true; force: true }): Promise<void>
  rmSync(path: string, options: { recursive: true; force: true }): void
}

export interface SourceViewOpenerDeps {
  /** `<userData>/uniwork-drafts-preview`: shared with the read-only draft previews */
  previewRoot: string
  /** the sync center's startup sweep of `previewRoot` (absent without a sync center); nothing is written before it settles */
  startupSweep?: Promise<unknown>
  registry: SourceViewRegistry
  /** the live session, null when signed out */
  identity(): { deploymentId: string } | null
  /** the saved profile of the deployment the app is configured for */
  profile(): { deploymentId: string } | null
  /** the account's keychain is locked (a cold restore with no session) */
  storeLocked(): boolean
  /** `documentLimits.max_bytes` of the connected server */
  documentMaxBytes(): number
  /** UNI-1961's client call: `GET /workspaces/{ws}/documents/sources/{id}/download` */
  downloadSource(workspaceId: string, sourceId: string): Promise<{ bytes: Uint8Array }>
  /** the shell's open router (`routeDocumentPath`) */
  openPath(path: string): boolean | Promise<boolean>
  isPathOpen(path: string): boolean
  now?(): number
  newSession?(): string
  fs?: Partial<SourceViewFs>
}

export interface SourceViewOpener {
  openSource(input: unknown): Promise<SourceViewResult<OpenSourceValue>>
  /** deletes the temp copy of every source whose tab has been closed for the grace */
  sweep(): Promise<void>
  /**
   * Account change / sign-out: asks `closePath` to close each registered tab,
   * then deletes the session folder and empties the registry. An open still
   * downloading is abandoned.
   */
  dropAll(closePath?: (path: string) => void | Promise<void>): Promise<void>
  /** quit: the same removal, synchronous so it finishes before the process exits */
  disposeSync(): void
}

const ok = <T>(value: T): SourceViewResult<T> => ({ ok: true, value })
const fail = (error: SourceViewErrorCode): SourceViewResult<never> => ({ ok: false, error })

/** the codes of a failed download that reach the user as they are; the rest are `open_failed` */
const PASSTHROUGH: ReadonlySet<string> = new Set([
  'not_signed_in',
  'session_expired',
  'wrong_deployment',
  'keystore_locked',
  'forbidden',
  'not_found',
  'deleted',
  'too_large',
  'network',
  'timeout',
  'server_error',
])

function mapDownloadError(error: unknown): SourceViewErrorCode {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code !== 'string') return 'open_failed'
  if (PASSTHROUGH.has(code)) return code as SourceViewErrorCode
  if (code === 'malformed_response') return 'server_error'
  if (code === 'member_deactivated' || code === 'organization_suspended') return 'forbidden'
  if (code === 'permission_revoked') return 'forbidden'
  if (code === 'document_deleted') return 'deleted'
  return 'open_failed'
}

function lastSegment(name: string): string {
  return name.split(/[\\/]/).pop() ?? ''
}

function capped(text: string): string {
  return text.slice(0, MAX_META_TEXT)
}

function parseInput(raw: unknown): OpenSourceInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  const workspaceId = text(r.workspaceId)
  const sourceId = text(r.sourceId)
  const name = text(r.name)
  const extension = text(r.extension)
  const size = r.sizeBytes
  if (!workspaceId || !sourceId || name === null || extension === null) return null
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null
  const parent =
    r.parent && typeof r.parent === 'object' ? (r.parent as Record<string, unknown>) : {}
  return {
    workspaceId,
    sourceId,
    name,
    extension,
    mimeType: text(r.mimeType) ?? '',
    sizeBytes: size,
    updatedAt: text(r.updatedAt) ?? '',
    origin: text(r.origin) ?? '',
    parent: { kind: text(parent.kind) ?? '', title: text(parent.title) ?? '' },
  }
}

/**
 * The temp file name: the row's last path segment with every character a
 * Windows path refuses replaced, no trailing dot or space, no reserved device
 * name, at most 120 characters, and exactly one `.ext` so the open router can
 * route it. A name can never carry a separator out of its folder.
 */
function safeFileName(name: string, extension: string): string {
  const suffix = `.${extension}`
  let stem = [...lastSegment(name)]
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"|?*'.includes(char) ? '_' : char))
    .join('')
  if (stem.toLowerCase().endsWith(suffix)) stem = stem.slice(0, -suffix.length)
  stem = stem.replace(/[. ]+$/, '').trim()
  if (WINDOWS_RESERVED.test(stem.split('.')[0] ?? '')) stem = `_${stem}`
  stem = stem.slice(0, MAX_FILE_NAME - suffix.length).replace(/[. ]+$/, '')
  return `${stem || 'source'}${suffix}`
}

interface OpenEntry {
  key: string
  dir: string
  path: string
  /** the last time a sweep (or the open itself) saw the tab open */
  lastOpenAt: number
}

export function createSourceViewOpener(deps: SourceViewOpenerDeps): SourceViewOpener {
  const fs: SourceViewFs = { mkdir, writeFile, chmod, rm, rmSync, ...deps.fs }
  const now = () => deps.now?.() ?? Date.now()
  const newSession = () => deps.newSession?.() ?? randomUUID()
  let session = newSession()
  /** bumped at every account boundary: an open that began before it must not land after it */
  let epoch = 0
  const entries = new Map<string, OpenEntry>()
  const inflight = new Map<string, Promise<SourceViewResult<OpenSourceValue>>>()

  const sessionDir = () => join(deps.previewRoot, `sources-${session}`)

  const removeDir = (dir: string) =>
    fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)

  const dropEntry = async (key: string): Promise<void> => {
    const entry = entries.get(key)
    if (!entry) return
    entries.delete(key)
    deps.registry.remove(entry.path)
    await removeDir(entry.dir)
  }

  const accessDenied = (): SourceViewErrorCode | null => {
    const identity = deps.identity()
    if (!identity) return deps.storeLocked() ? 'keystore_locked' : 'not_signed_in'
    const profile = deps.profile()
    if (!profile || profile.deploymentId !== identity.deploymentId) return 'wrong_deployment'
    return null
  }

  const fetchAndOpen = async (
    input: OpenSourceInput,
    extension: string,
    key: string,
  ): Promise<SourceViewResult<OpenSourceValue>> => {
    const startedAt = epoch
    let bytes: Uint8Array
    try {
      bytes = (await deps.downloadSource(input.workspaceId, input.sourceId)).bytes
    } catch (error) {
      return fail(mapDownloadError(error))
    }
    // the row's size is the renderer's word: the editors refuse anything over the max
    if (bytes.byteLength > deps.documentMaxBytes()) return fail('too_large')
    // the sweep removes the whole preview root: write only after it is done
    await Promise.resolve(deps.startupSweep).catch(() => undefined)
    if (epoch !== startedAt) return fail('not_signed_in')

    const hash = createHash('sha256').update(key).digest('hex').slice(0, 16)
    const dir = join(sessionDir(), hash)
    const path = join(dir, safeFileName(input.name, extension))
    try {
      // owner-only: the plaintext of an attachment must not be readable by other users
      await fs.mkdir(dir, { recursive: true, mode: 0o700 })
      await fs.writeFile(path, bytes)
      // a courtesy only: the registry, not the file mode, is what makes the view read-only
      await fs.chmod(path, 0o400).catch(() => undefined)
    } catch {
      await removeDir(dir)
      return fail('open_failed')
    }
    if (epoch !== startedAt) {
      await removeDir(dir)
      return fail('not_signed_in')
    }

    entries.set(key, { key, dir, path, lastOpenAt: now() })
    // registered BEFORE the open: the editor asks for its state the moment it loads the file
    deps.registry.add(path, {
      name: capped(lastSegment(input.name)),
      origin: capped(input.origin),
      parentTitle: capped(input.parent.title),
    })
    const opened = await Promise.resolve()
      .then(() => deps.openPath(path))
      .catch(() => false)
    if (!opened) {
      await dropEntry(key)
      return fail('open_failed')
    }
    return ok({ path, reused: false })
  }

  return {
    async openSource(raw) {
      const input = parseInput(raw)
      if (!input) return fail('not_found')
      const extension = input.extension.trim().replace(/^\./, '').toLowerCase()
      if (!SOURCE_EXTENSIONS.has(extension)) return fail('unsupported_format')
      const denied = accessDenied()
      if (denied) return fail(denied)
      // refused from the row's own size: nothing this large is fetched into memory
      if (input.sizeBytes > deps.documentMaxBytes()) return fail('too_large')

      const key = `${input.sourceId}|${input.updatedAt}|${input.sizeBytes}`
      // first: while a tab is still being created its path is not "open" yet, and the
      // live branch below would take that for a closed tab and delete the file
      const running = inflight.get(key)
      if (running) return running
      const live = entries.get(key)
      if (live) {
        if (deps.isPathOpen(live.path)) {
          live.lastOpenAt = now()
          return (await deps.openPath(live.path))
            ? ok({ path: live.path, reused: true })
            : fail('open_failed')
        }
        // its tab is gone: a new open shows the server's current bytes, not a stale temp copy
        await dropEntry(key)
      }
      const run = fetchAndOpen(input, extension, key).finally(() => {
        if (inflight.get(key) === run) inflight.delete(key)
      })
      inflight.set(key, run)
      return run
    },

    async sweep() {
      const at = now()
      for (const [key, entry] of [...entries]) {
        if (deps.isPathOpen(entry.path)) {
          entry.lastOpenAt = at
          continue
        }
        if (at - entry.lastOpenAt < SOURCE_VIEW_CLOSE_GRACE_MS) continue
        await dropEntry(key)
      }
    },

    async dropAll(closePath) {
      epoch += 1
      const paths = deps.registry.paths()
      for (const path of paths) {
        try {
          await closePath?.(path)
        } catch {
          /* a tab that will not close must not keep the others' files */
        }
      }
      const old = sessionDir()
      entries.clear()
      inflight.clear()
      for (const path of paths) deps.registry.remove(path)
      session = newSession()
      await removeDir(old)
    },

    disposeSync() {
      epoch += 1
      for (const path of deps.registry.paths()) deps.registry.remove(path)
      entries.clear()
      inflight.clear()
      try {
        fs.rmSync(sessionDir(), { recursive: true, force: true })
      } catch {
        /* the next start sweeps the whole root */
      }
    },
  }
}
