import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { chmod, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { UniworkDocLock } from '../../../shared/home-api'
import type { OfflineFailure } from '../../../shared/offline-library'
import type { Binding } from '../../uniwork-docs/binding-store'
import { formatForMime, formatForName, sanitizeFilename } from '../../uniwork-docs/formats'
import { APP_STORE_LEVEL } from '../store-level'
import type { OfflineLibraryManager } from './manager'
import { offlineFailureOf } from './view'

/**
 * G5-05u (B5): a pinned document opened with no network (or from the S3 "Mở")
 * is shown from its verified cached copy - NEVER edited (UNI-1645: the offline
 * edit hold is G5-08d). The copy is written beside the working copies of the
 * session, as a bound, view-only working copy under its own document key
 * (`<documentId>@offline`), on disk read-only (0o444, the kept-draft pattern).
 * It is deleted as soon as no window shows it any more and at sign-out, so no
 * plaintext of a pinned document outlives the option to read it.
 */

/** a window needs a moment to appear in the open-path list: the same grace as a kept draft */
export const OFFLINE_COPY_CLOSE_GRACE_MS = 30_000

/** the document-key suffix of the offline copy of a document (never its own working copy) */
export const OFFLINE_COPY_KEY_SUFFIX = '@offline'

/** the cap of one binding path segment (`SEGMENT`, binding-store.ts: the 128-char feed id plus a suffix does not fit) */
export const OFFLINE_COPY_KEY_MAX = 128

/**
 * Every entry of `dir` made writable: a copy left by an earlier session is
 * 0o444 (the kept-draft pattern), and neither `unlink` nor a rewrite may
 * touch it before that is undone. Unreadable folders are left alone.
 */
async function makeWritable(dir: string): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  await chmod(dir, 0o700).catch(() => undefined)
  for (const entry of entries) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) await makeWritable(target)
    else await chmod(target, 0o600).catch(() => undefined)
  }
}

/**
 * Delete a copy folder, undoing the read-only mode first (BE-R1-2). `false`
 * only when the folder is still there: the caller keeps its own record of the
 * copy, so a later sweep retries instead of forgetting a plaintext leftover.
 */
async function removeDir(dir: string): Promise<boolean> {
  await makeWritable(dir)
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 2 })
    return true
  } catch {
    return !(await stat(dir).then(
      () => true,
      () => false,
    ))
  }
}

export interface OfflineCopyRefusal {
  kind: 'refused'
  /** the renderer's refusal (S11 reason included) */
  failure: OfflineFailure
  /** the S11 lock the shell shows for the refused document */
  lock: UniworkDocLock
}

export type OfflineCopyOutcome =
  | { kind: 'opened'; path: string; title: string }
  | OfflineCopyRefusal
  /** nothing is pinned, or this session has no store to write into */
  | { kind: 'none' }

export interface OfflineCopiesDeps {
  /** the live library (null while no session wired one) */
  library(): OfflineLibraryManager | null
  /** the org capability `offline_library` */
  capabilityOn(orgId: string): Promise<boolean>
  /** the working-copy store of the live session */
  store: {
    dirFor(deploymentId: string, accountId: string, key: string): string
    write(dir: string, binding: Binding): Promise<boolean>
    /** the normal open path's own writer: the bytes go under `basename(filename)` */
    writeWorkingCopy(dir: string, filename: string, bytes: Uint8Array): Promise<string>
  }
  /** every working-copy folder of the account boundary: the leftover sweep walks them */
  scopeDirs(deploymentId: string, accountId: string): string[]
  scope(): { deploymentId: string; accountId: string } | null
  /** show the copy as a tab (`show`, the lock check, the open and the status push) */
  show(path: string): { path: string; title: string } | null
  isPathOpen(path: string): boolean
  appVersion(): string
  now?(): number
}

export interface OfflineCopies {
  /** the read-only copy of `documentId`, written and opened (or why not) */
  open(documentId: string): Promise<OfflineCopyOutcome>
  /** delete every copy no window shows any more (a poll and each account change run it) */
  sweep(): Promise<void>
  /** startup / account activation: every leftover `<id>@offline` folder of the account goes */
  recover(): Promise<void>
  /** sign-out / account switch: every copy goes, the engine is not called */
  dropAll(): Promise<void>
}

/**
 * The one copy key of a document: its own folder, so no real working copy is
 * touched. The key is the FULL sha256 hex of the document id plus `@offline`
 * (BE-R2-1): 72 characters, always inside one binding path segment, stable per
 * id, and two distinct ids can never share a folder - the old
 * head-plus-short-digest branch shared one namespace with the ids it shortened,
 * so an accepted 120-char id could alias a 128-char one and one open deleted
 * the other's plaintext.
 */
export function offlineCopyKey(documentId: string): string {
  const digest = createHash('sha256').update(documentId).digest('hex')
  return `${digest}${OFFLINE_COPY_KEY_SUFFIX}`
}

export function createOfflineCopies(deps: OfflineCopiesDeps): OfflineCopies {
  const now = () => deps.now?.() ?? Date.now()
  /** documentId -> the copy on screen (one per document, however many tabs read it) */
  const copies = new Map<string, { dir: string; path: string; title: string; openedAt: number }>()

  const drop = async (documentId: string, closed: boolean): Promise<boolean> => {
    const copy = copies.get(documentId)
    if (!copy) return true
    // a folder that would not go stays on the record: the next sweep retries
    // instead of forgetting a plaintext leftover (BE-R1-2)
    if (!(await removeDir(copy.dir))) return false
    copies.delete(documentId)
    // the pin's deferred cleanup waits for the last reader: tell the library the tab is gone
    if (closed)
      await deps
        .library()
        ?.markClosed(documentId)
        .catch(() => undefined)
    return true
  }

  const open = async (documentId: string): Promise<OfflineCopyOutcome> => {
    const library = deps.library()
    const scope = deps.scope()
    if (!library || !scope) return { kind: 'none' }
    const shownBefore = copies.get(documentId)
    if (shownBefore && deps.isPathOpen(shownBefore.path)) {
      // already on screen: bring it forward instead of writing a second copy
      return {
        kind: 'opened',
        path: shownBefore.path,
        title: deps.show(shownBefore.path)?.title ?? shownBefore.title,
      }
    }
    const dir = deps.store.dirFor(scope.deploymentId, scope.accountId, offlineCopyKey(documentId))
    const row = await library.row(documentId)
    const cached = await library.openCached(documentId)
    const capabilityOn = row ? await deps.capabilityOn(row.orgId).catch(() => false) : true
    if (cached.kind !== 'ok') {
      const failure = offlineFailureOf(cached, {
        capabilityOn,
        leaseLock: row?.lockReason ?? null,
      })
      if (failure.code === 'not_pinned' || failure.code === 'not_ready') return { kind: 'none' }
      // never a raw server name in a path (BE-R1-1): the lock names one safe segment
      const name = row?.filename ?? documentId
      const safeName = sanitizeFilename(name, formatForName(name) ?? 'docx')
      return {
        kind: 'refused',
        failure,
        lock: {
          path: join(dir, safeName),
          name: safeName,
          reason: failure.lockReason ?? 'lease_expired',
          ...(failure.libraryOff ? { libraryOff: true } : {}),
        },
      }
    }
    const format =
      formatForMime(cached.manifest.main.mimeType) ?? formatForName(cached.manifest.main.filename)
    if (!format || !row) return { kind: 'none' }
    // whatever an earlier session (a crash, a remove that failed) left under this
    // key goes before the new bytes land, whether this session knows the copy or not
    if (!(await removeDir(dir))) return { kind: 'none' }
    copies.delete(documentId)
    // the copy is named exactly as the normal open path names it: the manifest's
    // file name made one safe segment (BE-R1-1) - never the raw server string
    const filename = sanitizeFilename(cached.manifest.main.filename, format)
    const path = await deps.store.writeWorkingCopy(dir, filename, cached.bytes)
    // read-only on disk too: nothing may write this plaintext copy (the binding already says view)
    await chmod(path, 0o444).catch(() => undefined)
    const binding: Binding = {
      schema: 2,
      documentId,
      workspaceId: row.workspaceId,
      orgId: row.orgId,
      title: filename,
      filename,
      format,
      // UNI-1645: an offline copy is read-only
      access: 'view',
      level: 'view',
      // the copy is never saved from: it carries no revision of its own (the file itself is the copy)
      baseRevision: '0',
      baseVersion: cached.manifest.main.version,
      baseChecksum: cached.manifest.main.sha256,
      state: 'ready',
      minStoreLevel: APP_STORE_LEVEL,
      minAppVersion: deps.appVersion(),
      ...(cached.manifest.main.versionId ? { baseVersionId: cached.manifest.main.versionId } : {}),
    }
    if (!(await deps.store.write(dir, binding))) {
      await rm(dir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
      return { kind: 'none' }
    }
    const shown = deps.show(path)
    if (!shown) {
      await rm(dir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
      return { kind: 'none' }
    }
    // the pin's cleanup defers while a tab reads the copy (markClosed at its close)
    library.markOpen(documentId)
    copies.set(documentId, { dir, path, title: shown.title, openedAt: now() })
    return { kind: 'opened', path, title: shown.title }
  }

  const sweep = async (): Promise<void> => {
    const at = now()
    for (const [documentId, copy] of [...copies]) {
      if (deps.isPathOpen(copy.path)) continue
      if (at - copy.openedAt < OFFLINE_COPY_CLOSE_GRACE_MS) continue
      await drop(documentId, true)
    }
  }

  /**
   * Startup / account activation (BE-R1-2): a crash leaves the last session's
   * `<id>@offline` plaintext behind - nothing tracks it, so nothing would ever
   * delete it. Every `@offline` folder of the account goes here; a copy this
   * process still shows is left to its own sweep (`drop`).
   */
  const recover = async (): Promise<void> => {
    const scope = deps.scope()
    if (!scope) return
    const shown = new Set([...copies.values()].map((copy) => copy.dir))
    for (const dir of deps.scopeDirs(scope.deploymentId, scope.accountId)) {
      if (!basename(dir).endsWith(OFFLINE_COPY_KEY_SUFFIX)) continue
      if (shown.has(dir)) continue
      await removeDir(dir)
    }
  }

  const dropAll = async (): Promise<void> => {
    for (const [documentId, copy] of [...copies]) {
      // a folder that would not go is still a copy: it stays on the record
      if (await removeDir(copy.dir)) copies.delete(documentId)
    }
  }

  return { open, sweep, recover, dropAll }
}
