import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { chmod, lstat, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { UniworkDocLock } from '../../../shared/home-api'
import type { OfflineBlockedReason, OfflineFailure } from '../../../shared/offline-library'
import type { Binding } from '../../uniwork-docs/binding-store'
import { formatForMime, formatForName, sanitizeFilename } from '../../uniwork-docs/formats'
import { APP_STORE_LEVEL } from '../store-level'
import type { OfflineLibraryManager, PinRow } from './manager'
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

/** every file under `dir` back to read-only: undoes `makeWritable` for a removal that was called off */
async function makeReadOnly(dir: string): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) await makeReadOnly(target)
    else await chmod(target, 0o444).catch(() => undefined)
  }
}

/**
 * Only definite absence (`ENOENT`) counts as gone (BE-R2-8): any other
 * inspection failure (`EACCES`, `EIO`, `EBUSY`) leaves the folder in doubt, so
 * the caller keeps it on its retry list instead of forgetting plaintext.
 */
async function absent(dir: string): Promise<boolean> {
  try {
    await lstat(dir)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
  }
}

type RemoveOutcome = 'removed' | 'failed' | 'cancelled'

/**
 * Delete a copy folder, undoing the read-only mode first (BE-R1-2). `removed`
 * only when `rm` succeeded or `lstat` confirmed `ENOENT` (BE-R2-8). A
 * `stillDue` guard is read synchronously right before `rm` starts (G703-R7-1):
 * no await separates that last check from the deletion, so a lease renewal
 * that commits any time before it calls the removal off (`cancelled`).
 */
async function removeDir(dir: string, stillDue?: () => boolean): Promise<RemoveOutcome> {
  if (stillDue && !stillDue()) return 'cancelled'
  await makeWritable(dir)
  if (stillDue && !stillDue()) {
    await makeReadOnly(dir)
    return 'cancelled'
  }
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 2 })
    return 'removed'
  } catch {
    return (await absent(dir)) ? 'removed' : 'failed'
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
  /**
   * G703B-P1: raise the S11 lock for a copy that is ALREADY on screen when its
   * lease stops being usable (the open path raises it for a refused open)
   */
  lockOpened(lock: UniworkDocLock): void
  appVersion(): string
  /**
   * G703-R7-1: the lease manager's commit stamp of a document. It changes
   * whenever a lease commit starts or lands and is odd while one is in flight,
   * so a destructive lock decision made on an older read can tell it went stale.
   */
  leaseStamp?(documentId: string): number
  now?(): number
}

export interface OfflineCopies {
  /** the read-only copy of `documentId`, written and opened (or why not) */
  open(documentId: string): Promise<OfflineCopyOutcome>
  /**
   * every poll and each account change run it: it deletes every copy no window
   * shows any more, and locks (and deletes) a copy still on screen whose lease
   * is no longer usable
   */
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

const MAX_TIMEOUT_MS = 2_147_483_647

function parseExpiryMs(leaseUntil: string | null | undefined): number | null {
  if (!leaseUntil) return null
  const ms = Date.parse(leaseUntil)
  return Number.isFinite(ms) ? ms : null
}

interface TrackedCopy {
  dir: string
  path: string
  title: string
  openedAt: number
  locked: boolean
  orgId: string
  leaseUntilMs: number | null
  timer: NodeJS.Timeout | null
}

export function createOfflineCopies(deps: OfflineCopiesDeps): OfflineCopies {
  const now = () => deps.now?.() ?? Date.now()
  /** documentId -> the copy on screen (one per document, however many tabs read it) */
  const copies = new Map<string, TrackedCopy>()
  /** every folder whose deletion failed (tracked or crash leftover) until a retry confirms it gone (BE-R2-3, BE-R2-8, BE-R2-11) */
  const pendingRemoval = new Set<string>()
  /** one queue across open, sweep, recover and dropAll so recovery or sign-out never races an open (BE-R2-2, BE-R2-5) */
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const dropDirOutcome = async (dir: string, stillDue?: () => boolean): Promise<RemoveOutcome> => {
    const outcome = await removeDir(dir, stillDue)
    if (outcome === 'removed') pendingRemoval.delete(dir)
    else if (outcome === 'failed') pendingRemoval.add(dir)
    return outcome
  }

  const dropDir = async (dir: string): Promise<boolean> => (await dropDirOutcome(dir)) === 'removed'

  const retryPending = async (keepDirs: ReadonlySet<string>): Promise<void> => {
    for (const dir of [...pendingRemoval]) {
      if (keepDirs.has(dir)) continue
      await dropDir(dir)
    }
  }

  const clearTimer = (copy: TrackedCopy | undefined): void => {
    if (!copy?.timer) return
    clearTimeout(copy.timer)
    copy.timer = null
  }

  /**
   * `retry`: after a removal that failed or was called off, the lease expiry is
   * already behind us: a zero delay would spin, so the retry waits the close
   * grace (G703-R7-5)
   */
  const scheduleExpiry = (documentId: string, retry = false): void => {
    const copy = copies.get(documentId)
    clearTimer(copy)
    if (!copy || copy.locked) return
    const delay =
      copy.leaseUntilMs !== null && !retry
        ? Math.min(MAX_TIMEOUT_MS, Math.max(0, copy.leaseUntilMs - now()))
        : OFFLINE_COPY_CLOSE_GRACE_MS
    const timer = setTimeout(() => {
      if (copies.get(documentId) === copy) copy.timer = null
      void serial(sweepOne).catch(() => undefined)
    }, delay)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    copy.timer = timer
  }

  const drop = async (documentId: string, closed: boolean): Promise<boolean> => {
    const copy = copies.get(documentId)
    if (!copy) return true
    clearTimer(copy)
    // a folder that would not go stays on the record: the next sweep retries
    // instead of forgetting a plaintext leftover (BE-R1-2, BE-R2-8, BE-R2-11)
    if (!(await dropDir(copy.dir))) {
      scheduleExpiry(documentId)
      return false
    }
    copies.delete(documentId)
    // the pin's deferred cleanup waits for the last reader: tell the library the tab is gone
    if (closed)
      await deps
        .library()
        ?.markClosed(documentId)
        .catch(() => undefined)
    return true
  }

  /**
   * The plaintext goes, the tracked copy and its open-tab count stay (G703-R6-2).
   * `stillDue` calls the removal off when the reason it was decided on went stale.
   */
  const lockInPlace = async (
    documentId: string,
    stillDue?: () => boolean,
  ): Promise<RemoveOutcome> => {
    const copy = copies.get(documentId)
    if (!copy) return 'removed'
    clearTimer(copy)
    const outcome = await dropDirOutcome(copy.dir, stillDue)
    if (outcome !== 'removed') {
      // a failed removal retries at the lease expiry as before; a called-off one waits
      scheduleExpiry(documentId, outcome === 'cancelled')
      return outcome
    }
    copy.locked = true
    return 'removed'
  }
  const openOne = async (documentId: string): Promise<OfflineCopyOutcome> => {
    const library = deps.library()
    const scope = deps.scope()
    if (!library || !scope) return { kind: 'none' }
    const shownBefore = copies.get(documentId)
    const onScreen = shownBefore !== undefined && deps.isPathOpen(shownBefore.path)
    const dir = deps.store.dirFor(scope.deploymentId, scope.accountId, offlineCopyKey(documentId))
    const row = await library.row(documentId)
    // the lease check of openCached runs for a copy already on screen too: an
    // expired lease must not be brought forward (G703B-P1)
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
      const refusal: OfflineCopyRefusal = {
        kind: 'refused',
        failure,
        lock: {
          // the lock sits on the tab that shows the copy, when there is one
          path: onScreen ? shownBefore.path : join(dir, safeName),
          name: safeName,
          reason: failure.lockReason ?? 'lease_expired',
          ...(failure.libraryOff ? { libraryOff: true } : {}),
        },
      }
      // the refused copy does not stay served: its plaintext goes with the lock,
      // while the open-tab count stays until the tab closes (G703-R6-2)
      if (onScreen) await lockInPlace(documentId)
      return refusal
    }
    if (onScreen && !shownBefore.locked) {
      if (row) {
        shownBefore.orgId = row.orgId
        shownBefore.leaseUntilMs = parseExpiryMs(row.leaseUntil)
        scheduleExpiry(documentId)
      }
      return {
        kind: 'opened',
        path: shownBefore.path,
        title: deps.show(shownBefore.path)?.title ?? shownBefore.title,
      }
    }
    const format =
      formatForMime(cached.manifest.main.mimeType) ?? formatForName(cached.manifest.main.filename)
    if (!format || !row) return { kind: 'none' }
    if (shownBefore) {
      clearTimer(shownBefore)
      if (shownBefore.dir !== dir) pendingRemoval.add(shownBefore.dir)
    }
    // whatever an earlier session (a crash, a remove that failed) left under this
    // key goes before the new bytes land, whether this session knows the copy or not
    if (!(await dropDir(dir))) return { kind: 'none' }
    if (!onScreen) copies.delete(documentId)
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
      await dropDir(dir)
      return { kind: 'none' }
    }
    const shown = deps.show(path)
    if (!shown) {
      await dropDir(dir)
      return { kind: 'none' }
    }
    // the pin's cleanup defers while a tab reads the copy (markClosed at its close)
    if (!onScreen) library.markOpen(documentId)
    copies.set(documentId, {
      dir,
      path,
      title: shown.title,
      openedAt: now(),
      locked: false,
      orgId: row.orgId,
      leaseUntilMs: parseExpiryMs(row.leaseUntil),
      timer: null,
    })
    scheduleExpiry(documentId)
    return { kind: 'opened', path, title: shown.title }
  }

  /**
   * G703B-P1 / G703-R6-3: a copy still on screen whose lease lapsed (or was
   * rolled back / locked, or whose session scope is gone) is locked in place.
   * Each tracked copy also schedules its own expiry check, so a stopped feed or
   * lost session never leaves plaintext served silently.
   */
  const evaluateLapse = (
    documentId: string,
    copy: TrackedCopy,
    row: PinRow | null | undefined,
  ): OfflineBlockedReason | null => {
    if (row) {
      copy.orgId = row.orgId
      const nextExpiry = parseExpiryMs(row.leaseUntil)
      if (nextExpiry !== copy.leaseUntilMs || copy.timer === null) {
        copy.leaseUntilMs = nextExpiry
        scheduleExpiry(documentId)
      }
    }
    const expiredOffline =
      !row && (copy.leaseUntilMs !== null ? now() >= copy.leaseUntilMs : deps.scope() === null)
    const reason: OfflineBlockedReason | null =
      row?.lockReason ??
      (expiredOffline ? (copy.leaseUntilMs !== null ? 'lease_expired' : 'signed_out') : null)
    if (!reason && copy.timer === null) scheduleExpiry(documentId)
    return reason
  }

  const lockLapsed = async (documentId: string, copy: TrackedCopy): Promise<void> => {
    if (copy.locked) return
    const row = await deps
      .library()
      ?.row(documentId)
      .catch(() => null)
    const firstReason = evaluateLapse(documentId, copy, row)
    if (!firstReason) return
    const orgId = row?.orgId ?? copy.orgId
    const libraryOff =
      firstReason === 'lease_expired' && !(await deps.capabilityOn(orgId).catch(() => false))
    // G703-R6-4: revalidate right before the destructive step in case an online
    // renewal landed while capabilityOn was awaited
    if (copy.locked || copies.get(documentId) !== copy) return
    // G703-R7-1: the lease commit stamp is taken before that final read. A
    // commit in flight (odd) leaves the decision to the pass after it; one that
    // lands later changes the stamp, and the removal calls itself off
    const stamp = deps.leaseStamp?.(documentId) ?? 0
    if (stamp % 2 === 1) {
      scheduleExpiry(documentId, true)
      return
    }
    const rechecked = await deps
      .library()
      ?.row(documentId)
      .catch(() => null)
    const reason = evaluateLapse(documentId, copy, rechecked)
    if (!reason) return
    // the plaintext goes first: if it will not, the next pass retries the lock too
    const stillDue = (): boolean =>
      !copy.locked &&
      copies.get(documentId) === copy &&
      (deps.leaseStamp?.(documentId) ?? 0) === stamp
    if ((await lockInPlace(documentId, stillDue)) !== 'removed') return
    deps.lockOpened({
      path: copy.path,
      name: basename(copy.path),
      reason,
      ...(reason === 'lease_expired' && libraryOff ? { libraryOff: true } : {}),
    })
  }

  const sweepOne = async (): Promise<void> => {
    const at = now()
    for (const [documentId, copy] of [...copies]) {
      if (deps.isPathOpen(copy.path)) {
        await lockLapsed(documentId, copy)
        continue
      }
      if (at - copy.openedAt < OFFLINE_COPY_CLOSE_GRACE_MS) continue
      await drop(documentId, true)
    }
    const tracked = new Set([...copies.values()].map((copy) => copy.dir))
    await retryPending(tracked)
  }

  /**
   * Startup / account activation (BE-R1-2): a crash leaves the last session's
   * `<id>@offline` plaintext behind - nothing tracks it, so nothing would ever
   * delete it. Every `@offline` folder of the account goes here; a copy this
   * process still shows is left to its own sweep (`drop`), and any folder whose
   * removal fails stays in `pendingRemoval` for later sweeps (BE-R2-3).
   */
  const recoverOne = async (): Promise<void> => {
    const scope = deps.scope()
    if (!scope) return
    const shown = new Set([...copies.values()].map((copy) => copy.dir))
    await retryPending(shown)
    for (const dir of deps.scopeDirs(scope.deploymentId, scope.accountId)) {
      if (!basename(dir).endsWith(OFFLINE_COPY_KEY_SUFFIX)) continue
      if (shown.has(dir)) continue
      await dropDir(dir)
    }
  }

  const dropAllOne = async (): Promise<void> => {
    for (const [documentId, copy] of [...copies]) {
      clearTimer(copy)
      // a folder that would not go is still a copy: it stays on the record and in pendingRemoval
      if (await dropDir(copy.dir)) copies.delete(documentId)
    }
    const remaining = new Set([...copies.values()].map((copy) => copy.dir))
    await retryPending(remaining)
  }

  return {
    open: (documentId) => serial(() => openOne(documentId)),
    sweep: () => serial(sweepOne),
    recover: () => serial(recoverOne),
    dropAll: () => serial(dropAllOne),
  }
}
