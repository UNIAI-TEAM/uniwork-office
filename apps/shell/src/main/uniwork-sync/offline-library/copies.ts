import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { chmod, lstat, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { UniworkDocFormat, UniworkDocLock } from '../../../shared/home-api'
import type { OfflineBlockedReason, OfflineFailure } from '../../../shared/offline-library'
import type { Binding } from '../../uniwork-docs/binding-store'
import { formatForMime, formatForName, sanitizeFilename } from '../../uniwork-docs/formats'
import { APP_STORE_LEVEL } from '../store-level'
import type { CachedDocument, OfflineLibraryManager, PinRow } from './manager'
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

/**
 * FL-04a: a copy that is due by its own clock while the lease clock still reads the
 * lease usable (the lease clock runs up to about a second behind the wall clock) is
 * looked at again after this short, positive delay - never at once, never the grace.
 */
const OFFLINE_COPY_RECHECK_MS = 750
/** an expiry that moved less than this between two reads is the same expiry (read jitter) */
const EXPIRY_MOVED_MS = 1_000

/** how a copy's expiry check is armed */
type Arming = 'expiry' | 'retry' | 'recheck'

function parseExpiryMs(leaseUntil: string | null | undefined): number | null {
  if (!leaseUntil) return null
  const ms = Date.parse(leaseUntil)
  return Number.isFinite(ms) ? ms : null
}

/**
 * When the lease runs out, on this module's clock. The lease manager's own remaining
 * time wins (FL-04a): the row's lock reason comes from that clock, which can run
 * behind the wall clock, so a timer set from the wall-clock expiry fires before the
 * row is expired. A row with no clock reading falls back to its expiry timestamp.
 */
function expiryOf(row: PinRow, at: number): number | null {
  if (row.leaseRemainingMs !== undefined && Number.isFinite(row.leaseRemainingMs)) {
    return at + Math.max(0, row.leaseRemainingMs)
  }
  return parseExpiryMs(row.leaseUntil)
}

interface TrackedCopy {
  documentId: string
  dir: string
  path: string
  title: string
  openedAt: number
  locked: boolean
  orgId: string
  leaseUntilMs: number | null
  timer: NodeJS.Timeout | null
  /** whether this copy still holds the library's open-tab count (`markOpen` without its `markClosed`) */
  counted: boolean
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
   * grace (G703-R7-5). An expiry that is already due is enforced by the sweep
   * that got here, so it never arms a zero-delay timer either (G703-R8-3): the
   * sweep's own outcome (removed, failed, cancelled, deferred) decides what follows.
   * `recheck` (FL-04a): the copy is due by its own clock but the lease clock still
   * reads it usable - the short re-check delay, not the grace.
   */
  const scheduleExpiry = (documentId: string, arming: Arming = 'expiry'): void => {
    const copy = copies.get(documentId)
    clearTimer(copy)
    if (!copy || copy.locked) return
    const untilExpiry =
      copy.leaseUntilMs !== null && arming !== 'retry'
        ? copy.leaseUntilMs - now()
        : Number.NEGATIVE_INFINITY
    const delay =
      untilExpiry > 0
        ? Math.min(MAX_TIMEOUT_MS, untilExpiry)
        : arming === 'recheck'
          ? OFFLINE_COPY_RECHECK_MS
          : OFFLINE_COPY_CLOSE_GRACE_MS
    const timer = setTimeout(() => {
      if (copies.get(documentId) === copy) copy.timer = null
      void serial(sweepOne).catch(() => undefined)
    }, delay)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    copy.timer = timer
  }

  /** G703-R7-2: the one `markClosed` of a copy's tab, whatever the copy's lock state */
  const releaseTab = async (copy: TrackedCopy): Promise<void> => {
    if (!copy.counted) return
    copy.counted = false
    await deps
      .library()
      ?.markClosed(copy.documentId)
      .catch(() => undefined)
  }

  const drop = async (documentId: string, closed: boolean): Promise<boolean> => {
    const copy = copies.get(documentId)
    if (!copy) return true
    clearTimer(copy)
    // a folder that would not go stays on the record: the next sweep retries
    // instead of forgetting a plaintext leftover (BE-R1-2, BE-R2-8, BE-R2-11)
    if (!(await dropDir(copy.dir))) {
      scheduleExpiry(documentId, 'retry')
      return false
    }
    copies.delete(documentId)
    // the pin's deferred cleanup waits for the last reader: tell the library the tab is gone
    if (closed) await releaseTab(copy)
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
      scheduleExpiry(documentId, 'retry')
      return outcome
    }
    copy.locked = true
    return 'removed'
  }
  /**
   * The plaintext copy and its binding under `dir`, named exactly as the normal
   * open path names it: the manifest's file name made one safe segment
   * (BE-R1-1) - never the raw server string. Null when the binding would not write.
   */
  const writeCopy = async (
    documentId: string,
    dir: string,
    row: PinRow,
    cached: CachedDocument,
    format: UniworkDocFormat,
  ): Promise<string | null> => {
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
    return (await deps.store.write(dir, binding)) ? path : null
  }

  const formatOfCached = (cached: CachedDocument): UniworkDocFormat | null =>
    formatForMime(cached.manifest.main.mimeType) ?? formatForName(cached.manifest.main.filename)

  /**
   * G703-R11-1: the open work can outlast the whole remaining lease, so the deadline
   * captured at the row read is already behind us when the copy is tracked. The default
   * arming would pick the 30 s close grace for it and leave expired plaintext served;
   * the short, positive re-check reads the lease at once instead. A future deadline
   * keeps its own timer.
   */
  const armingAtOpen = (deadline: number | null): Arming =>
    deadline !== null && deadline <= now() ? 'recheck' : 'expiry'

  const openOne = async (documentId: string): Promise<OfflineCopyOutcome> => {
    const library = deps.library()
    const scope = deps.scope()
    if (!library || !scope) return { kind: 'none' }
    const shownBefore = copies.get(documentId)
    const onScreen = shownBefore !== undefined && deps.isPathOpen(shownBefore.path)
    const dir = deps.store.dirFor(scope.deploymentId, scope.accountId, offlineCopyKey(documentId))
    const row = await library.row(documentId)
    // G703-R10-1: the row's remaining time is a duration sampled at this read, and the open
    // path awaits below (openCached, the capability read, the write, the display) before the
    // copy is tracked. Turn it into an absolute deadline here, once, and carry that through
    // every branch: re-anchoring the sampled duration at the end would arm the expiry from the
    // end of the open work instead of from the real lease deadline.
    const rowDeadline = row ? expiryOf(row, now()) : null
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
      if (row && rowDeadline !== null) {
        shownBefore.orgId = row.orgId
        shownBefore.leaseUntilMs = rowDeadline
        scheduleExpiry(documentId, armingAtOpen(rowDeadline))
      }
      return {
        kind: 'opened',
        path: shownBefore.path,
        title: deps.show(shownBefore.path)?.title ?? shownBefore.title,
      }
    }
    const format = formatOfCached(cached)
    if (!format || !row) return { kind: 'none' }
    if (shownBefore) {
      clearTimer(shownBefore)
      if (shownBefore.dir !== dir) pendingRemoval.add(shownBefore.dir)
      // G703-R7-2: a retained copy whose tab closed before any sweep saw it gives
      // its open-tab count back exactly once, before the reopen takes a new one
      if (!onScreen) await releaseTab(shownBefore)
    }
    // whatever an earlier session (a crash, a remove that failed) left under this
    // key goes before the new bytes land, whether this session knows the copy or not
    if (!(await dropDir(dir))) return { kind: 'none' }
    if (!onScreen) copies.delete(documentId)
    const path = await writeCopy(documentId, dir, row, cached, format)
    if (!path) {
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
      documentId,
      dir,
      path,
      title: shown.title,
      openedAt: now(),
      locked: false,
      orgId: row.orgId,
      leaseUntilMs: rowDeadline,
      timer: null,
      counted: true,
    })
    scheduleExpiry(documentId, armingAtOpen(rowDeadline))
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
    let rearm = false
    if (row) {
      copy.orgId = row.orgId
      const nextExpiry = expiryOf(row, now())
      const moved =
        nextExpiry === null || copy.leaseUntilMs === null
          ? nextExpiry !== copy.leaseUntilMs
          : Math.abs(nextExpiry - copy.leaseUntilMs) >= EXPIRY_MOVED_MS
      if (moved) copy.leaseUntilMs = nextExpiry
      rearm = moved || copy.timer === null
    }
    const expiredOffline =
      !row && (copy.leaseUntilMs !== null ? now() >= copy.leaseUntilMs : deps.scope() === null)
    const reason: OfflineBlockedReason | null =
      row?.lockReason ??
      (expiredOffline ? (copy.leaseUntilMs !== null ? 'lease_expired' : 'signed_out') : null)
    // due by the copy's own clock while the lease clock still reads it usable: look again shortly
    const due = copy.leaseUntilMs !== null && copy.leaseUntilMs <= now()
    // a usable row with a due stored deadline always replaces an armed retry (the 30 s
    // grace of a cancelled removal) with the short re-check: the lease just read is the
    // one that decides now, and the movement threshold hides a subsecond renewal (G703-R10-2)
    if (rearm || (!reason && (due || copy.timer === null))) {
      scheduleExpiry(documentId, !reason && due ? 'recheck' : 'expiry')
    }
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
      scheduleExpiry(documentId, 'retry')
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
    // G703-R7-1 residual (Advisor option 2): a renewal that commits while the native
    // removal is already in flight cannot call it off - the plaintext is gone and this
    // lease_expired lock stands. The lease itself is valid, so the user's reopen
    // recovers: `openCached` sees the renewed lease and writes the copy again.
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
