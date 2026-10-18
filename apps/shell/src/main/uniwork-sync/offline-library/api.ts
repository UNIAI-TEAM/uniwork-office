import type { UniworkDocErrorCode, UniworkDocLock } from '../../../shared/home-api'
import type {
  OfflineDocState,
  OfflineFailure,
  OfflineLibrarySnapshot,
  OfflineResult,
  OfflineUnpinResult,
} from '../../../shared/offline-library'
import { UNIWORK_SYNC_CENTER_CHANNELS } from '../../../shared/sync-center'
import type { IpcMainLike } from '../sync-center'
import type { StoreLayer } from '../store'
import type { OfflineCopyOutcome } from './copies'
import type { OfflineLibraryManager, PinResult, RowResult } from './manager'
import {
  OFFLINE_LIBRARY_MAX_PINS,
  OFFLINE_LIBRARY_QUOTA_BYTES,
  createOfflineLibraryStore,
} from './store'
import { offlineFailureOf, offlineSnapshot } from './view'

/**
 * G5-05u (B3/B4): the offline library IPC of the Sync Center object.
 *
 * The renderer sends intents only (pin / unpin / cancel / downloadNow / open /
 * openFolder / state) and reads the projection: A04-3 holds, no call can set a
 * row ready, verified or a lease. `pin` and `downloadNow` return as soon as the
 * library took the request - the engine's promise resolves only after the
 * download, so it is never awaited here; the row arrives through the snapshot
 * push. A row's own change notifications are throttled to <= 4 pushes/s.
 */

/** the most pushes per second a single row's progress may cause */
export const OFFLINE_ROW_PUSH_INTERVAL_MS = 250

/** the engine's promise rejected: no refusal code names that (never expected) */
const FAILED = Symbol('offline-library-failed')
type Failed = typeof FAILED

/**
 * BE-R2-6: the service's open verdict, carried intact into S3 `Mở` so only the
 * network/timeout class falls back to the cached copy; a server refusal
 * (401/403/404/410) is the server's own verdict and never opens stale plaintext.
 */
export type OfflineDocumentOpenOutcome = { ok: true } | { ok: false; error: UniworkDocErrorCode }

function serverOpenFailureOf(error: UniworkDocErrorCode): OfflineFailure {
  switch (error) {
    case 'deleted':
    case 'document_deleted':
      return { ok: false, code: 'deleted', lockReason: 'document_deleted' }
    case 'permission_revoked':
    case 'forbidden':
    case 'not_found':
      return { ok: false, code: 'revoked', lockReason: 'permission_revoked' }
    case 'member_deactivated':
      return { ok: false, code: 'revoked', lockReason: 'member_deactivated' }
    case 'organization_suspended':
      return { ok: false, code: 'revoked', lockReason: 'organization_suspended' }
    case 'session_expired':
      return { ok: false, code: 'no_session', lockReason: 'session_expired' }
    case 'not_signed_in':
      return { ok: false, code: 'no_session', lockReason: 'signed_out' }
    case 'capability_off':
      return { ok: false, code: 'capability_off' }
    case 'unsupported_format':
      return { ok: false, code: 'not_a_file' }
    case 'too_large':
      return { ok: false, code: 'too_large' }
    case 'keystore_locked':
      return { ok: false, code: 'keystore_locked', lockReason: 'keystore_locked' }
    default:
      return { ok: false, code: 'unknown' }
  }
}

export interface OfflineLibraryApiDeps {
  /** the live library (null while no session wired one) */
  library(): OfflineLibraryManager | null
  /** the session's active organization (null before the org choice) */
  activeOrgId(): string | null
  /** the runtime's capability cache (the same read the header uses) */
  capabilityOn(orgId: string): Promise<boolean>
  /** signed out: rows are omitted, only the count of the last account's items is exposed */
  signedOut(): boolean
  /** the last signed-in account (the signed-out count's scope) */
  lastOwner(): { deploymentId: string; accountId: string } | null
  /**
   * The deployment this build runs against (the profile the service reads). The
   * last owner of another deployment is not this machine's library to count:
   * its existence is not shown here (G703B-P4, FL-08).
   */
  activeDeploymentId(): string | null
  /** the library's own encrypted layer (the signed-out count reads it) */
  libraryLayer(): StoreLayer
  /** S3 `Mở`: the normal open flow of a document (the server path when it opens) */
  openDocument(documentId: string): Promise<OfflineDocumentOpenOutcome>
  /** the verified cached copy, written read-only and opened (B5) */
  openCopy(documentId: string): Promise<OfflineCopyOutcome>
  /** `shell.openPath` of the library's folder */
  revealLibraryFolder(): Promise<boolean>
  /** S11: a refused offline open is recorded in main and pushed to the shell */
  lockRefused(lock: UniworkDocLock): void
  /** the S11 lock of an open the locked keychain refused (no session names the copy's folder) */
  keystoreLock(documentId: string): UniworkDocLock
  /** the snapshot re-read (the sync center's own debounce coalesces it) */
  changed(): void
  /** test seam: the clock of the push throttle */
  now?(): number
}

export interface OfflineLibraryApi {
  /** the offline block of every snapshot */
  snapshot(): Promise<OfflineLibrarySnapshot>
  /** one row changed in the engine: wake a waiting call, then push (throttled per row) */
  rowChanged(documentId: string): void
  pin(input: { documentId: string; workspaceId: string; orgId?: string }): Promise<OfflineResult>
  unpin(documentId: string, options?: { confirmed?: boolean }): Promise<OfflineUnpinResult>
  cancel(documentId: string): Promise<OfflineResult>
  downloadNow(documentId: string): Promise<OfflineResult>
  open(documentId: string): Promise<OfflineResult>
  openFolder(): Promise<OfflineResult>
  state(documentId: string): Promise<OfflineDocState>
}

/** register the offline library's channels (the same preload object, B4) */
export function registerOfflineLibraryIpc(ipcMain: IpcMainLike, api: OfflineLibraryApi): void {
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.offlinePin, (_event, input: unknown) => {
    const asked = (input ?? {}) as { documentId?: unknown; workspaceId?: unknown; orgId?: unknown }
    return api.pin({
      documentId: typeof asked.documentId === 'string' ? asked.documentId : '',
      workspaceId: typeof asked.workspaceId === 'string' ? asked.workspaceId : '',
      ...(typeof asked.orgId === 'string' ? { orgId: asked.orgId } : {}),
    })
  })
  ipcMain.handle(
    UNIWORK_SYNC_CENTER_CHANNELS.offlineUnpin,
    (_event, documentId: unknown, options: unknown) =>
      api.unpin(typeof documentId === 'string' ? documentId : '', {
        confirmed: (options as { confirmed?: unknown } | null)?.confirmed === true,
      }),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.offlineCancel, (_event, documentId: unknown) =>
    api.cancel(typeof documentId === 'string' ? documentId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.offlineDownloadNow, (_event, documentId: unknown) =>
    api.downloadNow(typeof documentId === 'string' ? documentId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.offlineOpen, (_event, documentId: unknown) =>
    api.open(typeof documentId === 'string' ? documentId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.offlineOpenFolder, () => api.openFolder())
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.offlineState, (_event, documentId: unknown) =>
    api.state(typeof documentId === 'string' ? documentId : ''),
  )
}

export function createOfflineLibraryApi(deps: OfflineLibraryApiDeps): OfflineLibraryApi {
  const now = () => deps.now?.() ?? Date.now()
  /** documentId -> the last push, and whether one is parked for it */
  const lastPush = new Map<string, number>()
  const parked = new Set<string>()
  /** documentId -> the calls waiting for the library to take their request */
  const waiters = new Map<string, Set<() => void>>()

  /** the caps a `offline_cap_reached` refusal reports (`uwOfflineCapReached {cap} {maxDocs}`) */
  const caps = async (
    library: OfflineLibraryManager,
  ): Promise<{ cap: number; maxDocs: number }> => {
    const quota = await library.quota().catch(() => null)
    return quota && !('code' in quota)
      ? { cap: quota.maxBytes, maxDocs: quota.maxPins }
      : { cap: OFFLINE_LIBRARY_QUOTA_BYTES, maxDocs: OFFLINE_LIBRARY_MAX_PINS }
  }

  const rowChanged = (documentId: string): void => {
    const waiting = waiters.get(documentId)
    if (waiting) {
      waiters.delete(documentId)
      for (const wake of waiting) wake()
    }
    const at = now()
    const since = at - (lastPush.get(documentId) ?? Number.NEGATIVE_INFINITY)
    if (since >= OFFLINE_ROW_PUSH_INTERVAL_MS) {
      lastPush.set(documentId, at)
      deps.changed()
      return
    }
    if (parked.has(documentId)) return
    parked.add(documentId)
    const timer = setTimeout(() => {
      parked.delete(documentId)
      lastPush.set(documentId, now())
      deps.changed()
    }, OFFLINE_ROW_PUSH_INTERVAL_MS - since)
    timer.unref?.()
  }

  /**
   * The engine's own answer, or the library taking the request (its first row
   * change) - whichever comes first. A download's promise resolves only when it
   * finishes, so waiting for it would hold the IPC call for the whole transfer.
   */
  const settled = async <T>(
    documentId: string,
    pending: Promise<T>,
  ): Promise<{ kind: 'settled'; value: T | Failed } | { kind: 'started' }> => {
    const started = new Promise<{ kind: 'started' }>((resolve) => {
      const wake = () => resolve({ kind: 'started' })
      const set = waiters.get(documentId) ?? new Set<() => void>()
      set.add(wake)
      waiters.set(documentId, set)
    })
    const answered = pending.then(
      (value): { kind: 'settled'; value: T | Failed } => ({ kind: 'settled', value }),
      (): { kind: 'settled'; value: T | Failed } => ({ kind: 'settled', value: FAILED }),
    )
    try {
      return await Promise.race([answered, started])
    } finally {
      waiters.delete(documentId)
    }
  }

  const snapshot = async (): Promise<OfflineLibrarySnapshot> => {
    const library = deps.library()
    const orgId = deps.activeOrgId()
    const capabilityOn = orgId ? await deps.capabilityOn(orgId).catch(() => false) : false
    const quota = library ? await library.quota().catch(() => null) : null
    const empty = {
      usedBytes: 0,
      maxBytes: OFFLINE_LIBRARY_QUOTA_BYTES,
      pins: 0,
      maxPins: OFFLINE_LIBRARY_MAX_PINS,
    }
    const used = quota && !('code' in quota) ? quota : empty
    if (!library || deps.signedOut()) {
      // signed out: the count of what the last account kept on this machine, never a name (OQ-UX11 a)
      const last = deps.lastOwner()
      const owner = last && last.deploymentId === deps.activeDeploymentId() ? last : null
      const index = owner
        ? await createOfflineLibraryStore({ layer: deps.libraryLayer(), scope: owner })
            .readIndex()
            .catch(() => null)
        : null
      return offlineSnapshot({
        capabilityOn,
        signedOut: true,
        signedOutLockedCount: index?.kind === 'ok' ? index.index.pins.length : 0,
        quota: empty,
        rows: [],
      })
    }
    const rows = await library.list()
    return offlineSnapshot({ capabilityOn, signedOut: false, quota: used, rows })
  }

  return {
    snapshot,
    rowChanged,

    async pin(input): Promise<OfflineResult> {
      const library = deps.library()
      if (!library) return { ok: false, code: 'no_session' }
      const { documentId, workspaceId } = input
      if (!documentId || !workspaceId) return { ok: false, code: 'invalid' }
      // main resolves the organization: the pin's own, else the session's active org
      const pinned = await library.row(documentId)
      const orgId = pinned?.orgId ?? input.orgId ?? deps.activeOrgId()
      if (!orgId) return { ok: false, code: 'no_session' }
      const pending = library.pin({ documentId, orgId, workspaceId })
      const outcome = await settled(documentId, pending)
      // the row is on its way: the push tells the renderer (and its own snapshot read)
      if (outcome.kind === 'started') return { ok: true }
      const result = outcome.value as PinResult | Failed
      if (result === FAILED) return { ok: false, code: 'unknown' }
      if (result.kind === 'pinned') return { ok: true }
      return offlineFailureOf(result, {
        capabilityOn: await deps.capabilityOn(orgId).catch(() => false),
        ...(result.code === 'offline_cap_reached' ? await caps(library) : {}),
      })
    },

    async unpin(documentId, options = {}): Promise<OfflineUnpinResult> {
      const library = deps.library()
      if (!library) return { ok: false, code: 'no_session' }
      if (!documentId) return { ok: false, code: 'invalid' }
      const row = await library.row(documentId)
      const orgId = row?.orgId ?? deps.activeOrgId()
      const result = await library.unpin(documentId, options)
      if (result.kind === 'unpinned') return { ok: true, deferred: result.deferred }
      if (result.kind === 'needsConfirm') return { ok: false, code: 'needs_confirm' }
      return offlineFailureOf(result, {
        capabilityOn: orgId ? await deps.capabilityOn(orgId).catch(() => false) : false,
        leaseLock: row?.lockReason ?? null,
      })
    },

    async cancel(documentId): Promise<OfflineResult> {
      const library = deps.library()
      if (!library) return { ok: false, code: 'no_session' }
      if (!documentId) return { ok: false, code: 'invalid' }
      library.cancel(documentId)
      return { ok: true }
    },

    async downloadNow(documentId): Promise<OfflineResult> {
      const library = deps.library()
      if (!library) return { ok: false, code: 'no_session' }
      if (!documentId) return { ok: false, code: 'invalid' }
      const row = await library.row(documentId)
      const pending = library.downloadNow(documentId)
      const outcome = await settled(documentId, pending)
      if (outcome.kind === 'started') return { ok: true }
      const result = outcome.value as RowResult | Failed
      if (result === FAILED) return { ok: false, code: 'unknown' }
      if (result.kind === 'ok') return { ok: true }
      return offlineFailureOf(result, {
        capabilityOn: row ? await deps.capabilityOn(row.orgId).catch(() => false) : false,
        leaseLock: row?.lockReason ?? null,
        ...(result.code === 'offline_cap_reached' ? await caps(library) : {}),
      })
    },

    async open(documentId): Promise<OfflineResult> {
      if (!documentId) return { ok: false, code: 'invalid' }
      // the normal open flow first: online it opens the server path (S3 `Mở`),
      // and on a network/timeout error the service's own fallback already runs;
      // a server refusal (401/403/404/410) is never overridden by the cache (BE-R2-6)
      const server = await deps
        .openDocument(documentId)
        .catch((): OfflineDocumentOpenOutcome => ({ ok: false, error: 'network' }))
      if (server.ok) return { ok: true }
      if (server.error !== 'network' && server.error !== 'timeout') {
        // G703B-P3: the tab never opened; the S11 keychain panel says "unlock the
        // machine and retry", the same as a refused copy does
        if (server.error === 'keystore_locked') deps.lockRefused(deps.keystoreLock(documentId))
        return serverOpenFailureOf(server.error)
      }
      const outcome = await deps.openCopy(documentId)
      if (outcome.kind === 'opened') return { ok: true }
      if (outcome.kind === 'refused') {
        // the tab never opened: the S11 panel is what explains it
        deps.lockRefused(outcome.lock)
        return outcome.failure
      }
      return { ok: false, code: 'offline' }
    },

    async openFolder(): Promise<OfflineResult> {
      const opened = await deps.revealLibraryFolder().catch(() => false)
      return opened ? { ok: true } : { ok: false, code: 'unknown' }
    },

    async state(documentId): Promise<OfflineDocState> {
      const library = deps.library()
      const row = library && documentId ? await library.row(documentId).catch(() => null) : null
      const orgId = row?.orgId ?? deps.activeOrgId()
      return {
        pinned: row !== null,
        state: row?.state ?? null,
        capabilityOn: orgId ? await deps.capabilityOn(orgId).catch(() => false) : false,
      }
    },
  }
}
