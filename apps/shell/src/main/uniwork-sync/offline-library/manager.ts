import { randomBytes } from 'node:crypto'
import type { OfflineBlockedReason } from '../../../shared/offline-library'
import { UniworkDocError } from '../../uniwork-docs/errors'
import type { DocumentDetail } from '../../uniwork-docs/parse'
import { ID } from '../feed/http'
import { isStoreSegment, type StoreScope } from '../keys'
import type { LeaseEffectiveState, LeaseRenewResult, LeaseRevokeNotice } from '../lease/manager'
import {
  stageSnapshot,
  wipeKeys,
  type FetchAssetPort,
  type LibraryDocsPort,
  type StageOutcome,
} from './downloader'
import {
  MAX_PIN_FILE_BYTES,
  largestFileBytes,
  manifestBytes,
  manifestFromDetail,
  sameSnapshot,
  verifyBytes,
  type PinManifest,
} from './manifest'
import {
  PIN_RECORD_SCHEMA,
  rowStateOf,
  type PinBaseState,
  type PinProgress,
  type PinRecord,
  type PinRowState,
} from './record'
import {
  OFFLINE_LIBRARY_MAX_PINS,
  OFFLINE_LIBRARY_QUOTA_BYTES,
  blobKey,
  generationKeys,
  type LibraryIndex,
  type LibraryWriteResult,
  type OfflineLibraryStore,
} from './store'

/**
 * The offline library of the signed-in session (G5-05, read-only pins under
 * UNI-1645). See CONTRACT.md beside this file for the states, codes and
 * reactions the tests name.
 *
 * - `pin` checks the capability (OQ-UX11 a), the 200-pin and 2 GiB quota and
 *   the 256 MiB file cap before anything is downloaded, takes the lease, and
 *   downloads into staging; only a snapshot whose every declared file verified
 *   from the store is committed (one atomic row write). Offline -> the row
 *   waits (`waiting-network`) and `onReconnect` downloads it.
 * - A failed re-download never touches the committed copy: cancel / network
 *   loss -> `interrupted`, a full disk or a bad update -> `update-kept`.
 * - `unpin` / `evict` / a revoke / a server delete remove every byte of the
 *   pin from the store (committed copy, assets and staging); drafts, intents
 *   and the queue are never reached from here. An open tab defers an unpin's
 *   cleanup until it closes.
 * - The account boundary (`lockBoundary`, or a scope/session change seen on
 *   any call) aborts every download; nothing staged before it is committed.
 */

export type LibraryRefusalCode =
  | 'offline_cap_reached'
  | 'too_large'
  | 'capability_off'
  | 'not_a_file'
  | 'not_pinned'
  | 'not_ready'
  | 'corrupt'
  | 'lease_unusable'
  | 'revoked'
  | 'deleted'
  | 'offline'
  | 'invalid'
  | 'store_full'
  | 'no_session'
  | 'keystore_locked'
  | 'keyring_unavailable'
  | 'interrupted'

export interface LibraryRefusal {
  kind: 'refused'
  code: LibraryRefusalCode
  /** `lease_unusable`: the lease state that refused the open */
  lease?: LeaseEffectiveState['state']
}

export interface PinRow {
  documentId: string
  orgId: string
  workspaceId: string
  /** the one S3 state the row shows (priority applied) */
  state: PinRowState
  baseState: PinBaseState
  progress: PinProgress | null
  bytes: number
  pinnedAt: number
  lastVerifiedAt: number | null
  readyVersion: number | null
  updateAvailable: boolean
  updateKept: boolean
  archived: boolean
  open: boolean
  failure?: string
  /**
   * G5-05u (B2): the projections the S3 view needs and the record does not hold
   * ready-made. Nothing persisted changes shape: these are read off the record
   * and the document's lease in `view()`.
   */
  /** the manifest's file name (the committed copy's, else the asked snapshot's) */
  filename: string | null
  /** the committed bytes, else the declared bytes of the snapshot on its way */
  sizeBytes: number | null
  /** the head version the pin asks for (`update-available` / `update-kept` rows) */
  headVersion: number | null
  /** ISO expiry of the lease behind the copy */
  leaseUntil: string | null
  /**
   * What the lease manager's own clock (server time at receipt + monotonic
   * elapsed, not the wall clock) says is left of the lease at this read. Absent
   * when the lease has no clock reading.
   */
  leaseRemainingMs?: number
  leaseLevel: 'view' | 'edit' | null
  /** why an update was kept instead of applied (`too_large` / `corrupt` / `store_full`) */
  updateKeptReason: string | null
  /** bytes a `disk-full` (or `store_full` kept update) row still needs */
  diskNeededBytes?: number
  /** the blocked reason of a `lease-expired` / `locked` row (S3 / S11) */
  lockReason: OfflineBlockedReason | null
}

export type PinResult = { kind: 'pinned'; row: PinRow } | LibraryRefusal
export type RowResult = { kind: 'ok'; row: PinRow } | LibraryRefusal
export type UnpinResult =
  { kind: 'unpinned'; deferred: boolean } | { kind: 'needsConfirm' } | LibraryRefusal

export interface CachedDocument {
  kind: 'ok'
  documentId: string
  manifest: PinManifest
  bytes: Uint8Array
  assets: Array<{ path: string; bytes: Uint8Array }>
  /** UNI-1645: an offline copy is never edited */
  readOnly: true
  lease: LeaseEffectiveState['state']
}

export interface LibraryQuota {
  usedBytes: number
  maxBytes: number
  pins: number
  maxPins: number
}

/** what the library needs from the lease manager of the same session */
export interface LibraryLeasePort {
  effectiveState(documentId: string): Promise<LeaseEffectiveState>
  grant(documentId: string): Promise<LeaseRenewResult>
  release(documentId: string): Promise<void>
}

export interface OfflineLibraryLimits {
  maxBytes: number
  maxPins: number
  maxFileBytes: number
}

export interface OfflineLibraryManagerOptions {
  store: OfflineLibraryStore
  scope(): StoreScope | null
  /** the live session id: a new sign-in is a new boundary */
  session(): string | null
  /** the documents client of the active deployment, null while none is usable */
  docs(): LibraryDocsPort | null
  /** declared-asset bytes; no production implementation yet (D residual) */
  fetchAsset?: FetchAssetPort
  /**
   * The manifest of a document head. v1: the main file only (`assets: []`);
   * a server asset manifest plugs in here (D residual).
   */
  manifestOf?(detail: DocumentDetail): PinManifest
  leases: LibraryLeasePort
  /** the org's `offline_library` app capability */
  capability(orgId: string): Promise<boolean>
  /** the document still has drafts or intents (unpin asks first) */
  hasLocalWork(documentId: string): Promise<boolean>
  isOnline?(): boolean
  clock: { now(): number }
  /** test seam: the staging generation id */
  newGeneration?(): string
  /** test seam only: production uses U-01's values */
  limits?: Partial<OfflineLibraryLimits>
  /** a row changed (state, progress): the S3 view re-reads it */
  onChange?(documentId: string): void
}

interface Job {
  controller: AbortController
  done: Promise<unknown>
}

/** one download: the row it started from and the staging generation it writes */
interface DownloadJob {
  record: PinRecord
  manifest: PinManifest
  generation: string
  keys: string[]
  controller: AbortController
  /** false once a boundary (sign-out, account switch) passed */
  live(): boolean
}

/** a download that was started under the document lock and runs outside it */
type Started = { kind: 'started'; done: Promise<PinRecord> }

type DownloadStart =
  | Started
  | { kind: 'settled'; record: PinRecord }
  /** the update does not fit the 2 GiB quota: nothing was written */
  | { kind: 'over_quota' }

type Unavailable = {
  kind: 'no_session' | 'keystore_locked' | 'keyring_unavailable' | 'interrupted'
}

const refused = (code: LibraryRefusalCode): LibraryRefusal => ({ kind: 'refused', code })

function isUnavailable(result: { kind: string }): result is Unavailable {
  return (
    result.kind === 'no_session' ||
    result.kind === 'keystore_locked' ||
    result.kind === 'keyring_unavailable' ||
    result.kind === 'interrupted'
  )
}

/** a committed copy's store keys, and the staging keys of a download */
function heldKeys(record: PinRecord): string[] {
  const keys: string[] = []
  if (record.readyGeneration && record.readyManifest) {
    keys.push(
      ...generationKeys(
        record.documentId,
        record.readyGeneration,
        record.readyManifest.assets.length,
      ),
    )
  }
  if (record.staging) keys.push(...record.staging.keys)
  return keys
}

/** the copy is gone: no committed manifest, generation or bytes */
function withoutCopy(record: PinRecord): PinRecord {
  return {
    ...record,
    readyManifest: null,
    readyGeneration: null,
    readyVersion: null,
    bytes: 0,
    staging: null,
    progress: null,
    updateAvailable: false,
    updateKept: false,
  }
}

/**
 * G5-05u (B2): the blocked reason of a row whose copy is held behind an
 * unusable lease. The lease state names it; a boundary lock says which session
 * reason it was. Read only for a `lease-expired` / `locked` row (S3 shows the
 * row state itself for every other refusal).
 */
function lockReasonOf(record: PinRecord, lease: LeaseEffectiveState | null): OfflineBlockedReason {
  const held = record.readyGeneration !== null
  if (!lease) return held ? 'lease_expired' : 'keystore_locked'
  switch (lease.state) {
    case 'expired':
      return 'lease_expired'
    case 'clock_rollback':
      return 'clock_rollback'
    case 'revoked':
      return 'permission_revoked'
    case 'keystore_locked':
    case 'keyring_unavailable':
      return 'keystore_locked'
    case 'locked':
      switch (lease.reason) {
        case 'session_expired':
          return 'session_expired'
        case 'keystore_locked':
        case 'keyring_unavailable':
          return 'keystore_locked'
        default:
          return 'signed_out'
      }
    case 'none':
      // a committed copy with no lease behind it cannot be opened; reconnecting grants one
      return 'lease_expired'
    default:
      return held ? 'lease_expired' : 'keystore_locked'
  }
}

/** how a metadata or download failure reads for the library */
function classify(
  error: unknown,
): 'offline' | 'deleted' | 'revoked' | 'not_a_file' | 'session' | 'other' {
  if (!(error instanceof UniworkDocError)) return 'offline'
  switch (error.code) {
    case 'network':
    case 'timeout':
      return 'offline'
    case 'deleted':
    case 'document_deleted':
      return 'deleted'
    case 'forbidden':
    case 'not_found':
    case 'permission_revoked':
      return 'revoked'
    case 'unsupported_format':
      return 'not_a_file'
    case 'not_signed_in':
    case 'session_expired':
      return 'session'
    default:
      return 'other'
  }
}

export class OfflineLibraryManager {
  private readonly options: OfflineLibraryManagerOptions
  private readonly limits: OfflineLibraryLimits
  private readonly jobs = new Map<string, Job>()
  private readonly progress = new Map<string, PinProgress>()
  private readonly openCounts = new Map<string, number>()
  private readonly docLocks = new Map<string, Promise<unknown>>()
  /**
   * A settled row the full store refused to write (ENOSPC takes the row write
   * too). Rows read from the store would keep saying `downloading`, so the
   * settled state is held here and preferred until a later write succeeds.
   */
  private readonly unsaved = new Map<string, PinRecord>()
  private indexLock: Promise<unknown> = Promise.resolve()
  /** bumped by every boundary: a download started before it never commits */
  private epoch = 0
  private lastToken: string | null | undefined = undefined
  /** the boundary whose leftovers recover() already settled */
  private recoveredEpoch = -1

  constructor(options: OfflineLibraryManagerOptions) {
    this.options = options
    this.limits = {
      maxBytes: options.limits?.maxBytes ?? OFFLINE_LIBRARY_QUOTA_BYTES,
      maxPins: options.limits?.maxPins ?? OFFLINE_LIBRARY_MAX_PINS,
      maxFileBytes: options.limits?.maxFileBytes ?? MAX_PIN_FILE_BYTES,
    }
  }

  // ---------------------------------------------------------------- boundary

  private token(): string | null {
    const scope = this.options.scope()
    if (!scope) return null
    return `${scope.deploymentId}/${scope.accountId}#${this.options.session() ?? ''}`
  }

  /** a scope or session change since the last call is a boundary */
  private checkBoundary(): StoreScope | null {
    const token = this.token()
    if (this.lastToken !== undefined && token !== this.lastToken) this.crossBoundary()
    this.lastToken = token
    return this.options.scope()
  }

  private crossBoundary(): void {
    this.epoch += 1
    for (const job of this.jobs.values()) job.controller.abort()
    this.progress.clear()
    this.openCounts.clear()
    this.unsaved.clear()
    this.options.store.forget()
  }

  /**
   * Sign-out / account switch: every download stops at once and none of them
   * commits; the wiring then wipes the library scope (OQ-UX11 a: the copies
   * go at sign-out). Synchronous, so it runs before the wipe.
   */
  lockBoundary(): void {
    this.crossBoundary()
    this.lastToken = this.token()
  }

  // ---------------------------------------------------------------- helpers

  private withDoc<T>(documentId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.docLocks.get(documentId) ?? Promise.resolve()
    const next = previous.then(run, run)
    const settled = next.then(
      () => undefined,
      () => undefined,
    )
    this.docLocks.set(documentId, settled)
    void settled.then(() => {
      if (this.docLocks.get(documentId) === settled) this.docLocks.delete(documentId)
    })
    return next
  }

  private withIndex<T>(run: (index: LibraryIndex) => Promise<{ write: boolean; value: T }>) {
    const task = async (): Promise<T | Unavailable | { kind: 'refused' }> => {
      const read = await this.options.store.readIndex()
      if (read.kind !== 'ok') return read
      const outcome = await run(read.index)
      if (outcome.write) {
        const written = await this.options.store.writeIndex(read.index)
        if (written.kind !== 'ok') {
          return isUnavailable(written) ? written : { kind: 'refused' as const }
        }
      }
      return outcome.value
    }
    const next = this.indexLock.then(task, task)
    this.indexLock = next.catch(() => undefined)
    return next
  }

  private changed(documentId: string): void {
    this.options.onChange?.(documentId)
  }

  private online(): LibraryDocsPort | null {
    if (this.options.isOnline && !this.options.isOnline()) return null
    return this.options.docs()
  }

  private manifestOf(detail: DocumentDetail): PinManifest {
    return this.options.manifestOf?.(detail) ?? manifestFromDetail(detail)
  }

  private newGeneration(): string {
    return this.options.newGeneration?.() ?? randomBytes(8).toString('hex')
  }

  private validIds(...ids: string[]): boolean {
    return ids.every(
      (value) => typeof value === 'string' && ID.test(value) && isStoreSegment(value),
    )
  }

  private async view(record: PinRecord): Promise<PinRow> {
    const lease = await this.options.leases.effectiveState(record.documentId)
    const state = rowStateOf(record, lease)
    const declared = record.manifest ? manifestBytes(record.manifest) : null
    const sizeBytes = record.bytes > 0 ? record.bytes : declared
    const needed = declared !== null ? declared - record.bytes : 0
    const keptUpdate = record.updateKept && record.failure === 'store_full'
    return {
      documentId: record.documentId,
      orgId: record.scope.orgId,
      workspaceId: record.scope.workspaceId,
      state,
      baseState: record.state,
      progress: this.progress.get(record.documentId) ?? record.progress,
      bytes: record.bytes,
      pinnedAt: record.pinnedAt,
      lastVerifiedAt: record.lastVerifiedAt,
      readyVersion: record.readyVersion,
      updateAvailable: record.updateAvailable,
      updateKept: record.updateKept,
      archived: record.archived,
      open: (this.openCounts.get(record.documentId) ?? 0) > 0,
      ...(record.failure !== undefined ? { failure: record.failure } : {}),
      filename: record.readyManifest?.main.filename ?? record.manifest?.main.filename ?? null,
      sizeBytes,
      headVersion: record.manifest?.main.version ?? null,
      leaseUntil: lease.record?.expires_at ?? null,
      ...(lease.remainingMs !== undefined ? { leaseRemainingMs: lease.remainingMs } : {}),
      leaseLevel: lease.level,
      updateKeptReason: record.updateKept ? (record.failure ?? null) : null,
      ...((state === 'disk-full' || keptUpdate) && needed > 0 ? { diskNeededBytes: needed } : {}),
      lockReason:
        state === 'lease-expired' || state === 'locked' ? lockReasonOf(record, lease) : null,
    }
  }

  /**
   * `epoch`: the boundary the row was read under. R4F-2 (UNI-1362): a row read
   * before a sign-out is never written back after it, so a moved epoch refuses
   * with no store call and no change notice.
   */
  private async put(record: PinRecord, epoch?: number): Promise<boolean> {
    if (epoch !== undefined && epoch !== this.epoch) return false
    const written = await this.options.store.putPin(record)
    if (written.kind === 'ok') this.unsaved.delete(record.documentId)
    // interrupted: the scope was wiped under the write, there is no row to announce
    if (written.kind !== 'interrupted') this.changed(record.documentId)
    return written.kind === 'ok'
  }

  /** the row as the library holds it: a settled state the store refused wins over the stored row */
  private held(record: PinRecord): PinRecord {
    return this.unsaved.get(record.documentId) ?? record
  }

  /** stop a download of the document and wait until it cleaned its staging */
  private async stopJob(documentId: string): Promise<void> {
    const job = this.jobs.get(documentId)
    if (!job) return
    job.controller.abort()
    await job.done.catch(() => undefined)
  }

  /**
   * Bytes the quota counts for a row: its committed copy, or the snapshot it
   * asked for while that is still on its way (waiting or downloading). A first
   * download that failed or was cancelled holds nothing, so it reserves
   * nothing; a retry checks the quota again.
   */
  private reserved(record: PinRecord): number {
    const asking =
      record.staging !== null ||
      record.state === 'waiting-network' ||
      record.state === 'downloading' ||
      record.state === 'verifying'
    if (!asking || !record.manifest) return record.bytes
    return Math.max(record.bytes, manifestBytes(record.manifest))
  }

  private async usedBytes(index: LibraryIndex, except?: string): Promise<number | Unavailable> {
    let used = 0
    for (const documentId of index.pins) {
      if (documentId === except) continue
      const read = await this.options.store.getPin(documentId)
      if (isUnavailable(read)) return read
      if (read.kind === 'ok') used += this.reserved(read.record)
    }
    return used
  }

  /**
   * T5-1: the cap check, the row write and the index entry are one step under
   * the index lock, so concurrent pins of different documents can never pass
   * the 200-pin or the 2 GiB check together. Null = reserved.
   */
  private async reserve(record: PinRecord): Promise<LibraryRefusal | null> {
    const documentId = record.documentId
    const outcome = await this.withIndex(async (index) => {
      const listed = index.pins.includes(documentId)
      const refuse = (code: LibraryRefusalCode) => ({ write: false, value: refused(code) })
      if (!listed && index.pins.length >= this.limits.maxPins) return refuse('offline_cap_reached')
      const asked = this.reserved(record)
      if (asked > 0) {
        const used = await this.usedBytes(index, documentId)
        if (typeof used !== 'number') return refuse(used.kind)
        if (used + asked > this.limits.maxBytes) return refuse('offline_cap_reached')
      }
      const written = await this.options.store.putPin(record)
      if (written.kind !== 'ok') {
        return refuse(
          isUnavailable(written)
            ? written.kind
            : written.kind === 'store_full'
              ? 'store_full'
              : 'invalid',
        )
      }
      if (!listed) index.pins.push(documentId)
      return { write: !listed, value: null }
    })
    if (outcome === null) return null
    if ('code' in outcome) return outcome
    // the index write failed after the row was written: the row goes again
    await this.options.store.deletePin(documentId)
    return refused(isUnavailable(outcome) ? outcome.kind : 'invalid')
  }

  /** a reservation whose pin did not go ahead (lease refused): row and index entry go */
  private async releaseReservation(documentId: string): Promise<void> {
    await this.withIndex(async (index) => {
      index.pins = index.pins.filter((id) => id !== documentId)
      return { write: true, value: undefined }
    })
    await this.options.store.deletePin(documentId)
  }

  private async ensureLease(documentId: string): Promise<LibraryRefusal | null> {
    const state = await this.options.leases.effectiveState(documentId)
    if (state.usable) return null
    if (state.state === 'revoked') return refused('revoked')
    if (state.state !== 'none' && state.state !== 'expired') return null
    const granted = await this.options.leases.grant(documentId)
    if (granted.kind === 'capability_off') return refused('capability_off')
    if (granted.kind === 'revoked') return refused('revoked')
    return null
  }

  // ---------------------------------------------------------------- download

  /**
   * Start downloading `manifest` into staging. Called under the document lock:
   * the `downloading` row (with its staging keys) is written here - under the
   * index lock too when `quota` asks for the 2 GiB check (T5-1), so that write
   * is the reservation. The transfer itself runs WITHOUT the document lock
   * (T5-2): `openCached` keeps serving the committed copy meanwhile. The job
   * takes the lock again only to settle, against the row as it is then.
   */
  private async beginDownload(
    record: PinRecord,
    manifest: PinManifest,
    options: { quota?: boolean } = {},
  ): Promise<DownloadStart> {
    const documentId = record.documentId
    const epoch = this.epoch
    const token = this.token()
    const live = () => this.epoch === epoch && this.token() === token
    const generation = this.newGeneration()
    const keys = generationKeys(documentId, generation, manifest.assets.length)
    const total = manifestBytes(manifest)
    const downloading: PinRecord = {
      ...record,
      manifest,
      state: 'downloading',
      staging: { generation, keys },
      progress: { receivedBytes: 0, totalBytes: total },
    }
    delete downloading.failure
    // the staging keys are on record before any byte is written, so a crash
    // still names every staging blob for recover() to delete
    const write = () => this.options.store.putPin(downloading)
    const started: LibraryWriteResult | 'over_quota' = options.quota
      ? await this.withIndex<LibraryWriteResult | 'over_quota'>(async (index) => {
          const used = await this.usedBytes(index, documentId)
          if (typeof used !== 'number') return { write: false, value: used }
          if (used + total > this.limits.maxBytes) {
            return { write: false, value: 'over_quota' as const }
          }
          return { write: false, value: await write() }
        })
      : await write()
    if (started === 'over_quota') return { kind: 'over_quota' }
    if (started.kind !== 'ok') {
      const outcome: StageOutcome =
        started.kind === 'store_full'
          ? { kind: 'store_full' }
          : started.kind === 'interrupted'
            ? { kind: 'interrupted', reason: 'boundary' }
            : started.kind === 'refused'
              ? { kind: 'failed', code: 'refused' }
              : started
      return { kind: 'settled', record: await this.settleFailure(record, outcome, live) }
    }
    this.unsaved.delete(documentId)
    this.progress.set(documentId, { receivedBytes: 0, totalBytes: total })
    this.changed(documentId)
    const controller = new AbortController()
    const job: DownloadJob = { record, manifest, generation, keys, controller, live }
    const done = this.transfer(job).finally(() => {
      if (this.jobs.get(documentId)?.controller === controller) this.jobs.delete(documentId)
      this.progress.delete(documentId)
    })
    this.jobs.set(documentId, { controller, done })
    return { kind: 'started', done }
  }

  /** the network part of a download: no document lock is held while it runs */
  private async transfer(job: DownloadJob): Promise<PinRecord> {
    const { manifest, generation, live } = job
    const documentId = job.record.documentId
    const outcome = await stageSnapshot({
      store: this.options.store,
      docs: this.options.docs() ?? {
        getDocument: () => Promise.reject(new UniworkDocError('network')),
        downloadStream: () => Promise.reject(new UniworkDocError('network')),
      },
      ...(this.options.fetchAsset ? { fetchAsset: this.options.fetchAsset } : {}),
      documentId,
      manifest,
      generation,
      signal: job.controller.signal,
      live,
      onProgress: (progress) => {
        if (!live()) return
        this.progress.set(documentId, progress)
        this.changed(documentId)
      },
      onVerifying: () =>
        this.withDoc(documentId, async () => {
          if (!live()) return
          const current = await this.options.store.getPin(documentId)
          if (current.kind !== 'ok' || current.record.staging?.generation !== generation) return
          await this.options.store.putPin({ ...current.record, state: 'verifying' })
          this.changed(documentId)
        }),
    })
    this.progress.delete(documentId)
    return this.withDoc(documentId, () => this.settleDownload(job, outcome))
  }

  /**
   * Commit or settle a finished transfer, under the document lock, against the
   * row as it is NOW: a revoke, a delete, an unpin or an eviction that ran
   * meanwhile took the staging off the row, and then nothing of this download
   * is kept or committed. Otherwise the commit is one atomic row write; the
   * replaced copy's blobs go after it.
   */
  private async settleDownload(job: DownloadJob, outcome: StageOutcome): Promise<PinRecord> {
    const { manifest, generation, keys, live } = job
    const documentId = job.record.documentId
    const stopped: PinRecord = {
      ...job.record,
      state: 'interrupted',
      staging: null,
      progress: null,
    }
    // the scope was wiped or switched: nothing of it is kept, nothing is written
    // (not even a delete: it would re-open the wiped scope and re-create its
    // folder; the staging keys are on the row, so the wipe or recover() takes them)
    if (!live()) return stopped
    const read = await this.options.store.getPin(documentId)
    if (read.kind !== 'ok' || read.record.staging?.generation !== generation) {
      await wipeKeys(this.options.store, keys)
      return read.kind === 'ok' ? read.record : stopped
    }
    const current = read.record
    if (outcome.kind !== 'staged') {
      await wipeKeys(this.options.store, keys)
      return this.settleFailure(current, outcome, live)
    }
    const committed: PinRecord = {
      ...current,
      manifest,
      readyManifest: manifest,
      readyGeneration: generation,
      readyVersion: manifest.main.version,
      state: 'ready',
      bytes: outcome.bytes,
      lastVerifiedAt: this.options.clock.now(),
      staging: null,
      progress: null,
      updateAvailable: false,
      updateKept: false,
    }
    delete committed.failure
    // the one atomic commit: this row write is what makes the copy ready
    const written = await this.options.store.putPin(committed)
    if (written.kind !== 'ok' || !live()) {
      if (live()) await wipeKeys(this.options.store, keys)
      const failure: StageOutcome =
        written.kind === 'store_full'
          ? { kind: 'store_full' }
          : { kind: 'interrupted', reason: 'boundary' }
      return this.settleFailure(current, failure, live)
    }
    this.unsaved.delete(documentId)
    // the previous copy is replaced: its blobs go
    if (current.readyGeneration && current.readyManifest) {
      await wipeKeys(
        this.options.store,
        generationKeys(documentId, current.readyGeneration, current.readyManifest.assets.length),
      )
    }
    this.changed(documentId)
    return committed
  }

  /**
   * The row after a download that did not commit. The committed copy of
   * `record` stays: an interrupted download shows `interrupted` (the old copy
   * still opens), a full disk or a bad update of a held copy is
   * `update-kept`, and of a first download `disk-full` / `corrupt`.
   */
  private async settleFailure(
    record: PinRecord,
    outcome: Exclude<StageOutcome, { kind: 'staged' }>,
    live: () => boolean,
  ): Promise<PinRecord> {
    // the scope was wiped or switched: nothing is written into it
    if (!live()) return { ...record, state: 'interrupted', staging: null, progress: null }
    if (
      outcome.kind === 'failed' &&
      (outcome.code === 'deleted' || outcome.code === 'document_deleted')
    ) {
      return (await this.purgeRecord(record, 'deleted')) ?? record
    }
    if (
      outcome.kind === 'failed' &&
      (outcome.code === 'forbidden' ||
        outcome.code === 'not_found' ||
        outcome.code === 'permission_revoked')
    ) {
      return (await this.purgeRecord(record, 'revoked')) ?? record
    }
    const held = record.readyGeneration !== null
    const settled: PinRecord = { ...record, staging: null, progress: null }
    switch (outcome.kind) {
      case 'store_full':
        if (held) {
          settled.state = 'ready'
          settled.updateKept = true
          settled.updateAvailable = false
        } else {
          settled.state = 'disk-full'
        }
        settled.failure = 'store_full'
        break
      case 'corrupt':
      case 'too_large':
        if (held) {
          settled.state = 'ready'
          settled.updateKept = true
          settled.updateAvailable = false
        } else {
          settled.state = 'corrupt'
        }
        settled.failure = outcome.kind === 'corrupt' ? outcome.reason : 'too_large'
        break
      default:
        settled.state = 'interrupted'
        settled.failure =
          outcome.kind === 'interrupted'
            ? outcome.reason
            : outcome.kind === 'failed'
              ? outcome.code
              : outcome.kind
        break
    }
    // a full store refuses this row too: the user must still see the settled
    // state (disk-full / update-kept), so it is held in memory until a write lands
    if (!(await this.put(settled))) this.unsaved.set(settled.documentId, settled)
    return settled
  }

  // ---------------------------------------------------------------- removal

  /**
   * Delete every byte the pin holds (committed copy, assets, staging) and keep
   * the row as `state`. Drafts are never reached from here: the lease keeps
   * them locked. Runs at once, an open tab or not: a revoke or a delete does
   * not wait for a reader.
   */
  private async purgeRecord(
    record: PinRecord,
    state: 'revoked' | 'deleted',
    epoch?: number,
  ): Promise<PinRecord | null> {
    await wipeKeys(this.options.store, heldKeys(record))
    const purged: PinRecord = { ...withoutCopy(record), state }
    delete purged.failure
    return (await this.put(purged, epoch)) ? purged : null
  }

  private async purge(documentId: string, state: 'revoked' | 'deleted'): Promise<PinRow | null> {
    this.checkBoundary()
    // R4F-2 (UNI-1362): read -> delete -> write spans several awaits; a sign-out
    // in between must not let the revoked / deleted row be written after it
    const epoch = this.epoch
    await this.stopJob(documentId)
    return this.withDoc(documentId, async () => {
      const read = await this.options.store.getPin(documentId)
      if (read.kind !== 'ok') return null
      const purged = await this.purgeRecord(read.record, state, epoch)
      return purged ? this.view(purged) : null
    })
  }

  /** a server delete (feed / 410): committed cache + assets deleted, row `deleted` */
  handleDeleted(documentId: string): Promise<PinRow | null> {
    return this.purge(documentId, 'deleted')
  }

  /** `permission_revoked` (or 403/404 on refresh): cache + assets deleted, row `revoked` */
  handlePermissionRevoked(documentId: string): Promise<PinRow | null> {
    return this.purge(documentId, 'revoked')
  }

  /**
   * The lease manager's revoke notice (renew lost permission, feed revoke). Its
   * reason is the server code: a delete found at renewal (`document_deleted`,
   * `deleted`) shows `deleted`, every permission loss `revoked` (T5-4).
   */
  async handleLeaseRevoked(notice: LeaseRevokeNotice): Promise<PinRow | null> {
    if (!notice.deleteCommittedCache) return null
    const deleted = notice.reason === 'document_deleted' || notice.reason === 'deleted'
    return this.purge(notice.documentId, deleted ? 'deleted' : 'revoked')
  }

  /**
   * R5BE-1b: the feed's archived flag of a document (an archive does not bump
   * the revision, so the flag itself is the signal). Archived -> the row is
   * marked (no metadata read); restored -> the head is read again, which
   * clears the mark. A document that is not pinned is not touched.
   */
  async noteArchived(documentId: string, archived: boolean): Promise<PinRow | null> {
    const row = await this.row(documentId)
    if (!row || row.archived === archived) return row
    if (archived) return this.handleArchived(documentId)
    const refreshed = await this.refresh(documentId)
    return refreshed.kind === 'ok' ? refreshed.row : this.row(documentId)
  }

  /** archived on the server: the row stays and opens until the lease ends */
  async handleArchived(documentId: string): Promise<PinRow | null> {
    this.checkBoundary()
    // R4F-2 (UNI-1362): the flag is written back only under the boundary it was read in
    const epoch = this.epoch
    return this.withDoc(documentId, async () => {
      const read = await this.options.store.getPin(documentId)
      if (read.kind !== 'ok') return null
      const archived = { ...read.record, archived: true }
      await this.put(archived, epoch)
      if (this.epoch !== epoch) return null
      return this.view(archived)
    })
  }

  // ---------------------------------------------------------------- public API

  async pin(input: { documentId: string; orgId: string; workspaceId: string }): Promise<PinResult> {
    const scope = this.checkBoundary()
    if (!scope) return refused('no_session')
    const { documentId, orgId, workspaceId } = input
    if (!this.validIds(documentId, orgId, workspaceId)) return refused('invalid')
    // OQ-UX11 (a): with the capability off no new pin is taken
    if (!(await this.options.capability(orgId))) return refused('capability_off')
    const outcome = await this.withDoc(documentId, async (): Promise<PinResult | Started> => {
      const existing = await this.options.store.getPin(documentId)
      if (isUnavailable(existing)) return refused(existing.kind)
      if (existing.kind === 'ok') return { kind: 'pinned', row: await this.view(existing.record) }
      const index = await this.options.store.readIndex()
      if (index.kind !== 'ok') return refused(isUnavailable(index) ? index.kind : 'invalid')
      if (index.index.pins.length >= this.limits.maxPins) return refused('offline_cap_reached')

      const base: PinRecord = {
        schema: PIN_RECORD_SCHEMA,
        documentId,
        scope: { orgId, workspaceId },
        manifest: null,
        readyManifest: null,
        readyGeneration: null,
        readyVersion: null,
        state: 'waiting-network',
        progress: null,
        bytes: 0,
        pinnedAt: this.options.clock.now(),
        lastVerifiedAt: null,
        staging: null,
        updateAvailable: false,
        updateKept: false,
        archived: false,
      }

      const docs = this.online()
      let detail: DocumentDetail | null = null
      if (docs) {
        try {
          detail = await docs.getDocument(documentId)
        } catch (error) {
          const kind = classify(error)
          if (kind === 'deleted') return refused('deleted')
          if (kind === 'revoked') return refused('revoked')
          if (kind === 'not_a_file') return refused('not_a_file')
          if (kind === 'session') return refused('no_session')
          // offline or a server hiccup: the pin waits for the network
          detail = null
        }
      }

      let manifest: PinManifest | null = null
      if (detail) {
        manifest = this.manifestOf(detail)
        if (largestFileBytes(manifest) > this.limits.maxFileBytes) return refused('too_large')
      }

      const record: PinRecord = {
        ...base,
        manifest,
        archived: detail?.archivedAt != null,
      }
      // the quota is checked and the pin reserved in one step (T5-1)
      const reservation = await this.reserve(record)
      if (reservation) return reservation
      if (manifest) {
        const lease = await this.ensureLease(documentId)
        if (lease) {
          await this.releaseReservation(documentId)
          return lease
        }
      }
      this.changed(documentId)
      if (!manifest) return { kind: 'pinned', row: await this.view(record) }
      const begun = await this.beginDownload(record, manifest)
      if (begun.kind === 'started') return begun
      return {
        kind: 'pinned',
        row: await this.view(begun.kind === 'settled' ? begun.record : record),
      }
    })
    // the transfer runs outside the document lock (T5-2)
    if (outcome.kind !== 'started') return outcome
    return { kind: 'pinned', row: await this.view(await outcome.done) }
  }

  /** "Hủy tải": the download stops, staging is wiped, the old copy (if any) stays */
  cancel(documentId: string): boolean {
    const job = this.jobs.get(documentId)
    if (!job) return false
    job.controller.abort()
    return true
  }

  /**
   * Read the head and update the row: archived, deleted or revoked on the
   * server, or a newer version (`update-available`). With `download`, a newer
   * or missing copy is downloaded ("Tải ngay" / "Thử lại").
   */
  async refresh(documentId: string, options: { download?: boolean } = {}): Promise<RowResult> {
    if (!this.checkBoundary()) return refused('no_session')
    const outcome = await this.withDoc(documentId, async (): Promise<RowResult | Started> => {
      const read = await this.options.store.getPin(documentId)
      if (isUnavailable(read)) return refused(read.kind)
      if (read.kind !== 'ok') return refused('not_pinned')
      let record = read.record
      const gone = record.state === 'revoked' || record.state === 'deleted'
      // OQ-UX11 (a): kept copies stay, but nothing is refreshed or renewed
      if (!(await this.options.capability(record.scope.orgId))) return refused('capability_off')
      const docs = this.online()
      if (!docs) return refused('offline')
      let detail: DocumentDetail
      try {
        detail = await docs.getDocument(documentId)
      } catch (error) {
        const kind = classify(error)
        if (kind === 'deleted' || kind === 'revoked') {
          // a download in flight stops; its settle finds the staging gone and keeps nothing
          this.jobs.get(documentId)?.controller.abort()
          const purged = await this.purgeRecord(record, kind)
          return purged ? { kind: 'ok', row: await this.view(purged) } : refused(kind)
        }
        if (kind === 'session') return refused('no_session')
        return refused('offline')
      }
      const manifest = this.manifestOf(detail)
      if (gone) {
        // T5-5 (EXPERIENCE "restored"): the server answers for the document
        // again, so the pin waits for the network (or downloads now). The old
        // lease was revoked with it: it is dropped so a fresh one is granted.
        const lease = await this.options.leases.effectiveState(documentId)
        if (lease.state === 'revoked') {
          await this.options.leases.release(documentId).catch(() => undefined)
        }
        record = { ...withoutCopy(record), state: 'waiting-network' }
        delete record.failure
      }
      const newer = !record.readyManifest || !sameSnapshot(record.readyManifest, manifest)
      const sameAsked = record.manifest !== null && sameSnapshot(record.manifest, manifest)
      // a kept update stays kept only for the same snapshot; a newer one is offered again
      const updateKept = record.updateKept && sameAsked && newer
      record = {
        ...record,
        manifest,
        archived: detail.archivedAt !== null,
        updateAvailable: record.readyManifest !== null && newer && !updateKept,
        updateKept,
      }
      // the head is the copy already held: a failed retry of it is settled
      if (!newer && record.readyGeneration !== null && record.state !== 'ready') {
        record = { ...record, state: 'ready' }
        delete record.failure
      }
      // a download already in flight is not started twice
      if (!options.download || !newer || this.jobs.has(documentId)) {
        await this.put(record)
        return { kind: 'ok', row: await this.view(record) }
      }
      if (largestFileBytes(manifest) > this.limits.maxFileBytes) {
        const kept = await this.settleFailure(record, { kind: 'too_large' }, () => true)
        return { kind: 'ok', row: await this.view(kept) }
      }
      const lease = await this.ensureLease(documentId)
      if (lease) return lease
      // the 2 GiB check and the downloading row are one step (T5-1)
      const begun = await this.beginDownload(record, manifest, { quota: true })
      if (begun.kind === 'over_quota') {
        // T5-5: a pin with no copy is recorded as refused, so an online pass
        // does not retry it every time; "Thử lại" checks the quota again
        await this.put(
          record.readyGeneration === null
            ? { ...record, state: 'interrupted', failure: 'offline_cap_reached' }
            : { ...record, manifest: read.record.manifest },
        )
        return refused('offline_cap_reached')
      }
      if (begun.kind === 'started') return begun
      return { kind: 'ok', row: await this.view(begun.record) }
    })
    // the transfer runs outside the document lock (T5-2)
    if (outcome.kind !== 'started') return outcome
    return { kind: 'ok', row: await this.view(await outcome.done) }
  }

  /** "Tải ngay" / "Thử lại" */
  downloadNow(documentId: string): Promise<RowResult> {
    return this.refresh(documentId, { download: true })
  }

  /** the network is back: every row waiting for it downloads now */
  async onReconnect(): Promise<Map<string, RowResult>> {
    const results = new Map<string, RowResult>()
    if (!this.checkBoundary() || !this.online()) return results
    // the first online pass of a session settles what a crash left behind
    if (this.recoveredEpoch !== this.epoch) {
      this.recoveredEpoch = this.epoch
      await this.recover()
    }
    const index = await this.options.store.readIndex()
    if (index.kind !== 'ok') return results
    for (const documentId of index.index.pins) {
      const read = await this.options.store.getPin(documentId)
      if (read.kind !== 'ok' || read.record.state !== 'waiting-network') continue
      results.set(documentId, await this.downloadNow(documentId))
    }
    return results
  }

  /**
   * Bỏ ghim: only this pin's committed copy, assets and staging are deleted
   * (never drafts, intents or the queue). With drafts or intents the caller
   * confirms first (`uwOfflineUnpinConfirm`). While a tab has the document
   * open, the bytes are deleted once the last tab closes.
   */
  async unpin(documentId: string, options: { confirmed?: boolean } = {}): Promise<UnpinResult> {
    if (!this.checkBoundary()) return refused('no_session')
    const epoch = this.epoch
    if (!options.confirmed && (await this.options.hasLocalWork(documentId))) {
      if (!this.checkBoundary()) return refused('no_session')
      if (this.epoch !== epoch) return refused('interrupted')
      return { kind: 'needsConfirm' }
    }
    if (!this.checkBoundary()) return refused('no_session')
    if (this.epoch !== epoch) return refused('interrupted')
    await this.stopJob(documentId)
    return this.withDoc(documentId, async (): Promise<UnpinResult> => {
      if (!this.checkBoundary()) return refused('no_session')
      if (this.epoch !== epoch) return refused('interrupted')
      const read = await this.options.store.getPin(documentId)
      if (isUnavailable(read)) return refused(read.kind)
      if (read.kind !== 'ok') return refused('not_pinned')
      const keys = heldKeys(read.record)
      const deferred = (this.openCounts.get(documentId) ?? 0) > 0
      const listed = await this.withIndex(async (index) => {
        index.pins = index.pins.filter((id) => id !== documentId)
        if (deferred && keys.length > 0) {
          index.cleanup[documentId] = [...(index.cleanup[documentId] ?? []), ...keys]
        }
        return { write: true, value: true }
      })
      if (listed !== true) return refused((listed as Unavailable).kind ?? 'invalid')
      if (!deferred) await wipeKeys(this.options.store, keys)
      await this.options.store.deletePin(documentId)
      this.progress.delete(documentId)
      this.unsaved.delete(documentId)
      await this.options.leases.release(documentId).catch(() => undefined)
      this.changed(documentId)
      return { kind: 'unpinned', deferred }
    })
  }

  /** drop the committed copy (and any staging) but keep the pin: it downloads again */
  async evict(documentId: string): Promise<RowResult> {
    if (!this.checkBoundary()) return refused('no_session')
    await this.stopJob(documentId)
    return this.withDoc(documentId, async (): Promise<RowResult> => {
      const read = await this.options.store.getPin(documentId)
      if (isUnavailable(read)) return refused(read.kind)
      if (read.kind !== 'ok') return refused('not_pinned')
      await wipeKeys(this.options.store, heldKeys(read.record))
      const evicted: PinRecord = { ...withoutCopy(read.record), state: 'waiting-network' }
      delete evicted.failure
      await this.put(evicted)
      return { kind: 'ok', row: await this.view(evicted) }
    })
  }

  /** a tab opened the document (its unpin cleanup waits for the last close) */
  markOpen(documentId: string): void {
    this.checkBoundary()
    this.openCounts.set(documentId, (this.openCounts.get(documentId) ?? 0) + 1)
  }

  /** a tab closed it: a deferred unpin cleanup runs once no tab is left */
  async markClosed(documentId: string): Promise<void> {
    this.checkBoundary()
    const count = (this.openCounts.get(documentId) ?? 0) - 1
    if (count > 0) {
      this.openCounts.set(documentId, count)
      return
    }
    this.openCounts.delete(documentId)
    await this.finishCleanup(documentId)
  }

  private async finishCleanup(documentId: string): Promise<void> {
    await this.withIndex(async (index) => {
      const keys = index.cleanup[documentId]
      if (!keys) return { write: false, value: undefined }
      await wipeKeys(this.options.store, keys)
      delete index.cleanup[documentId]
      return { write: true, value: undefined }
    })
  }

  /**
   * Startup: finish deferred cleanups (no tab is open yet) and settle every
   * download a crash left behind - its staging is deleted, the row reads
   * `interrupted`, the committed copy (if any) stays.
   */
  async recover(): Promise<void> {
    if (!this.checkBoundary()) return
    const index = await this.options.store.readIndex()
    if (index.kind !== 'ok') return
    for (const documentId of Object.keys(index.index.cleanup)) {
      if ((this.openCounts.get(documentId) ?? 0) === 0) await this.finishCleanup(documentId)
    }
    for (const documentId of index.index.pins) {
      if (this.jobs.has(documentId)) continue
      await this.withDoc(documentId, async () => {
        const read = await this.options.store.getPin(documentId)
        if (read.kind !== 'ok' || !read.record.staging) return
        await wipeKeys(this.options.store, read.record.staging.keys)
        const stale = read.record.state === 'downloading' || read.record.state === 'verifying'
        await this.put({
          ...read.record,
          staging: null,
          progress: null,
          state: stale ? 'interrupted' : read.record.state,
        })
      })
    }
  }

  /** the document is in the library (any row state); the feed-gone filter reads it (T5-3) */
  async isPinned(documentId: string): Promise<boolean> {
    if (!this.checkBoundary()) return false
    const index = await this.options.store.readIndex()
    return index.kind === 'ok' && index.index.pins.includes(documentId)
  }

  /** every document in the library, one index read (R6BE-1: the feed's archived filter) */
  async pinnedIds(): Promise<ReadonlySet<string>> {
    if (!this.checkBoundary()) return new Set()
    const index = await this.options.store.readIndex()
    return new Set(index.kind === 'ok' ? index.index.pins : [])
  }

  async row(documentId: string): Promise<PinRow | null> {
    if (!this.checkBoundary()) return null
    const read = await this.options.store.getPin(documentId)
    return read.kind === 'ok' ? this.view(this.held(read.record)) : null
  }

  async list(): Promise<PinRow[]> {
    if (!this.checkBoundary()) return []
    const index = await this.options.store.readIndex()
    if (index.kind !== 'ok') return []
    const rows: PinRow[] = []
    for (const documentId of index.index.pins) {
      const read = await this.options.store.getPin(documentId)
      if (read.kind === 'ok') rows.push(await this.view(this.held(read.record)))
    }
    return rows
  }

  async quota(): Promise<LibraryQuota | LibraryRefusal> {
    if (!this.checkBoundary()) return refused('no_session')
    const index = await this.options.store.readIndex()
    if (index.kind !== 'ok') return refused(isUnavailable(index) ? index.kind : 'invalid')
    const used = await this.usedBytes(index.index)
    if (typeof used !== 'number') return refused(used.kind)
    return {
      usedBytes: used,
      maxBytes: this.limits.maxBytes,
      pins: index.index.pins.length,
      maxPins: this.limits.maxPins,
    }
  }

  /**
   * The verified committed copy, read-only (UNI-1645). Refused unless the
   * lease allows opening; a copy that fails verification is never served -
   * the row turns `corrupt` and its bytes are deleted.
   */
  async openCached(documentId: string): Promise<CachedDocument | LibraryRefusal> {
    if (!this.checkBoundary()) return refused('no_session')
    return this.withDoc(documentId, async (): Promise<CachedDocument | LibraryRefusal> => {
      const read = await this.options.store.getPin(documentId)
      if (isUnavailable(read)) return refused(read.kind)
      if (read.kind !== 'ok') return refused('not_pinned')
      const record = read.record
      if (record.state === 'revoked' || record.state === 'deleted') return refused(record.state)
      if (!record.readyGeneration || !record.readyManifest) return refused('not_ready')
      const lease = await this.options.leases.effectiveState(documentId)
      if (!lease.usable) return { kind: 'refused', code: 'lease_unusable', lease: lease.state }
      const manifest = record.readyManifest
      const generation = record.readyGeneration
      const files = [
        { key: blobKey(documentId, generation, 'main'), expected: manifest.main, path: null },
        ...manifest.assets.map((asset, index) => ({
          key: blobKey(documentId, generation, index),
          expected: asset,
          path: asset.path,
        })),
      ]
      let main: Uint8Array | null = null
      const assets: Array<{ path: string; bytes: Uint8Array }> = []
      for (const file of files) {
        const blob = await this.options.store.getBlob(file.key)
        if (isUnavailable(blob)) return refused(blob.kind)
        if (blob.kind !== 'ok' || verifyBytes(file.expected, blob.bytes) !== 'ok') {
          // never served from a bad cache: the copy is dropped, the row is corrupt
          await wipeKeys(this.options.store, heldKeys(record))
          const corrupt: PinRecord = {
            ...withoutCopy(record),
            state: 'corrupt',
            failure: blob.kind === 'ok' ? 'checksum_mismatch' : blob.kind,
          }
          await this.put(corrupt)
          return refused('corrupt')
        }
        if (file.path === null) main = blob.bytes
        else assets.push({ path: file.path, bytes: blob.bytes })
      }
      await this.options.store.putPin({ ...record, lastVerifiedAt: this.options.clock.now() })
      return {
        kind: 'ok',
        documentId,
        manifest,
        bytes: main as Uint8Array,
        assets,
        readOnly: true,
        lease: lease.state,
      }
    })
  }
}

export function createOfflineLibraryManager(
  options: OfflineLibraryManagerOptions,
): OfflineLibraryManager {
  return new OfflineLibraryManager(options)
}
