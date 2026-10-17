import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UniworkDocLock } from '../../../shared/home-api'
import type { OfflineFailure } from '../../../shared/offline-library'
import type { Binding } from '../../uniwork-docs/binding-store'
import { formatForMime, formatForName } from '../../uniwork-docs/formats'
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
  }
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
  /** sign-out / account switch: every copy goes, the engine is not called */
  dropAll(): Promise<void>
}

/** the one copy key of a document: its own folder, so no real working copy is touched */
export function offlineCopyKey(documentId: string): string {
  return `${documentId}${OFFLINE_COPY_KEY_SUFFIX}`
}

export function createOfflineCopies(deps: OfflineCopiesDeps): OfflineCopies {
  const now = () => deps.now?.() ?? Date.now()
  /** documentId -> the copy on screen (one per document, however many tabs read it) */
  const copies = new Map<string, { dir: string; path: string; title: string; openedAt: number }>()

  const drop = async (documentId: string, closed: boolean): Promise<void> => {
    const copy = copies.get(documentId)
    if (!copy) return
    copies.delete(documentId)
    await rm(copy.dir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
    // the pin's deferred cleanup waits for the last reader: tell the library the tab is gone
    if (closed)
      await deps
        .library()
        ?.markClosed(documentId)
        .catch(() => undefined)
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
      return {
        kind: 'refused',
        failure,
        lock: {
          path: join(dir, row?.filename ?? documentId),
          name: row?.filename ?? documentId,
          reason: failure.lockReason ?? 'lease_expired',
          ...(failure.libraryOff ? { libraryOff: true } : {}),
        },
      }
    }
    const format =
      formatForMime(cached.manifest.main.mimeType) ?? formatForName(cached.manifest.main.filename)
    if (!format || !row) return { kind: 'none' }
    const filename = cached.manifest.main.filename
    const path = join(dir, filename)
    await drop(documentId, false)
    await mkdir(dir, { recursive: true })
    await writeFile(path, cached.bytes)
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

  const dropAll = async (): Promise<void> => {
    const dirs = [...copies.values()].map((copy) => copy.dir)
    copies.clear()
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
    }
  }

  return { open, sweep, dropAll }
}
