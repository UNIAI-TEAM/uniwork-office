import type { StoreScope } from '../keys'
import { ID } from '../feed/http'
import {
  advanceWallClock,
  anchorLeaseReceipt,
  applyOnlineServerTimeCheck,
  evaluateLeaseClock,
  type LeaseClockSource,
} from './clock'
import {
  LeaseClientError,
  type LeaseClient,
  type LeaseFailure,
  type OfficeOfflineLeaseSDO,
} from './client'
import { LEASE_RECORD_SCHEMA, parseLeaseRecord, type LeaseLevel, type LeaseRecord } from './record'
import type { LeaseStore } from './store'

/**
 * Per-document offline lease state machine (DOC-005 §6.2, G5-08c).
 *
 * Effective states:
 *   `valid | expiring_soon (< 4 h) | expired (lease_expired) | clock_rollback | revoked | keystore_locked | none`
 *   plus `level` (`view | edit | null`).
 *
 * Rules:
 * - Renew only when online, at startup and on reconnect, when < 50 % of the TTL
 *   is left (row 2); never offline; new expiry is non-cumulative (taken from
 *   the server SDO).
 * - Response `version_id` differs from the loaded version -> `needs_refresh`
 *   (caller downloads head then renews; row 19).
 * - `offline_lease_revoked` on renew -> re-grant with empty body once when
 *   online (row 4: signature/secret rotation recovery); if that also fails ->
 *   `revoked`.
 * - `document_archived` -> keep existing lease until expiry, then lock (row 14).
 * - `office_capability_off` -> keep existing lease until expiry (row 12).
 * - Feed event `office_lease.revoked` (ids only: `user_id`, `document_id`,
 *   `lease_id`) -> lock at once (row 16, §6.2.2) and mark committed cache for
 *   deletion while keeping drafts.
 * - 401/403 session -> lock at once (`locked`, reason `session_expired`).
 * - The account boundary (`lockBoundary`): sign-out locks every lease at once
 *   as `signed_out` without waiting for the server (a best-effort DELETE is
 *   fired, never awaited); an account or deployment switch drops the outgoing
 *   scope's state and never locks the incoming one. An org change is not a
 *   boundary: it never reaches the lease manager. A scope that returns (the
 *   same account signing in again, which is a new session) starts unlocked.
 *   No offline cold-login: no session -> no usable lease (`none`).
 */

export type LeaseEffectiveStateKind =
  | 'valid'
  | 'expiring_soon'
  | 'expired'
  | 'clock_rollback'
  | 'revoked'
  /** a boundary lock of the whole session: the reason says which */
  | 'locked'
  | 'keystore_locked'
  | 'keyring_unavailable'
  | 'none'

export type LeaseLockReason =
  'signed_out' | 'account_switch' | 'deployment_switch' | 'session_expired'

export type LeaseStateReason =
  | 'lease_expired'
  | 'clock_rollback'
  | 'keystore_locked'
  | 'keyring_unavailable'
  | 'revoked'
  | 'signed_out'
  | 'account_switch'
  | 'deployment_switch'
  | 'session_expired'

export interface LeaseEffectiveState {
  state: LeaseEffectiveStateKind
  kind: LeaseEffectiveStateKind
  level: LeaseLevel | null
  locked: boolean
  usable: boolean
  reason?: LeaseStateReason
  needs_refresh?: boolean
  record?: LeaseRecord
  remainingMs?: number
}

export interface LeaseRevokedEventPayload {
  user_id: string
  document_id: string
  lease_id: string
}

export interface LeaseRevokeNotice {
  documentId: string
  leaseId?: string
  userId?: string
  reason: string
  /** Revoke marks the committed cache for deletion while keeping local drafts (W2/G5-05) */
  deleteCommittedCache: true
  keepDrafts: true
}

export type LeaseRenewResult =
  | { kind: 'renewed'; record: LeaseRecord; state: LeaseEffectiveState }
  | {
      kind: 'needs_refresh'
      documentId: string
      loadedVersionId: string
      headVersionId: string
      headVersion: number
      headRevision: string
      record: LeaseRecord
      sdo: OfficeOfflineLeaseSDO
    }
  | { kind: 'not_due'; state: LeaseEffectiveState }
  | { kind: 'offline'; state: LeaseEffectiveState }
  | { kind: 'archived'; record: LeaseRecord; state: LeaseEffectiveState }
  | { kind: 'capability_off'; state: LeaseEffectiveState }
  | { kind: 'revoked'; state: LeaseEffectiveState }
  /** a boundary lock (signed_out, ...) refuses grants and renewals */
  | { kind: 'locked'; state: LeaseEffectiveState }
  | { kind: 'keystore_locked'; state: LeaseEffectiveState }
  | { kind: 'keyring_unavailable'; state: LeaseEffectiveState }
  /** the server granted, but the store could not keep it: nothing is kept */
  | { kind: 'store_full'; state: LeaseEffectiveState }
  | { kind: 'session_expired'; state: LeaseEffectiveState }
  | { kind: 'none'; state: LeaseEffectiveState }
  | { kind: 'failed'; failure: LeaseFailure; state: LeaseEffectiveState }

export interface LeaseManagerOptions {
  store: LeaseStore
  client: () => LeaseClient | null
  clock: LeaseClockSource
  scope: () => StoreScope | null
  /**
   * The live session of the scope (the device session id). A new sign-in of
   * the same account is a new session, so the boundary resets even when the
   * signed-out gap between the two was never observed. Required: without it
   * nothing tells such a sign-in from a lock taken while the scope is live
   * (R2BE-1).
   */
  session: () => string | null
  isOnline?: () => boolean
  loadedVersionId?: (documentId: string) => string | null | undefined
  onRevoked?: (notice: LeaseRevokeNotice) => void
  onSessionExpired?: () => void
}

/** the boundary locks that refuse a grant or renewal until the scope changes */
const BOUNDARY_LOCKS: ReadonlySet<LeaseLockReason> = new Set([
  'signed_out',
  'account_switch',
  'deployment_switch',
])

/**
 * Which boundary `owner` (the scope that is leaving) crosses, given the scope
 * signed in now: none left (or the same one, mid sign-out) is a sign-out.
 */
export function boundaryLockReason(
  owner: StoreScope | null,
  current: StoreScope | null,
): LeaseLockReason {
  if (!owner || !current) return 'signed_out'
  if (owner.deploymentId !== current.deploymentId) return 'deployment_switch'
  if (owner.accountId !== current.accountId) return 'account_switch'
  return 'signed_out'
}

/**
 * The `office_lease.revoked` payload (ids only), or null when it is not one.
 * Nothing in the shell produces it yet: the server sends it on the user-scope
 * outbox/realtime channel, which the desktop has no client for (R1BE-5, open
 * Advisor decision). Until then a revoke lands through the renew 403.
 */
export function parseLeaseRevokedEvent(payload: unknown): LeaseRevokedEventPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const row = payload as Record<string, unknown>
  const { user_id, document_id, lease_id } = row
  if (typeof user_id !== 'string' || !ID.test(user_id)) return null
  if (typeof document_id !== 'string' || !ID.test(document_id)) return null
  if (typeof lease_id !== 'string' || !ID.test(lease_id)) return null
  return { user_id, document_id, lease_id }
}

function makeState(
  state: LeaseEffectiveStateKind,
  extra: {
    level?: LeaseLevel | null
    reason?: LeaseStateReason
    needs_refresh?: boolean
    record?: LeaseRecord
    remainingMs?: number
  } = {},
): LeaseEffectiveState {
  const usable = state === 'valid' || state === 'expiring_soon'
  const locked =
    state === 'expired' ||
    state === 'clock_rollback' ||
    state === 'revoked' ||
    state === 'locked' ||
    state === 'keystore_locked' ||
    state === 'keyring_unavailable'
  return {
    state,
    kind: state,
    level: extra.level ?? null,
    locked,
    usable,
    ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
    ...(extra.needs_refresh ? { needs_refresh: true } : {}),
    ...(extra.record !== undefined ? { record: extra.record } : {}),
    ...(extra.remainingMs !== undefined ? { remainingMs: extra.remainingMs } : {}),
  }
}

/** a store outcome that is not a record: the state it means, or null */
function unavailableState(result: { kind: string }): LeaseEffectiveState | null {
  if (result.kind === 'keystore_locked') {
    return makeState('keystore_locked', { reason: 'keystore_locked' })
  }
  if (result.kind === 'keyring_unavailable') {
    return makeState('keyring_unavailable', { reason: 'keyring_unavailable' })
  }
  if (result.kind === 'no_session') return makeState('none')
  return null
}

/** the same, as the result of a grant or renewal */
function unavailableResult(result: { kind: string }): LeaseRenewResult | null {
  const state = unavailableState(result)
  if (!state) return null
  if (state.state === 'keystore_locked') return { kind: 'keystore_locked', state }
  if (state.state === 'keyring_unavailable') return { kind: 'keyring_unavailable', state }
  return { kind: 'none', state }
}

export class LeaseManager {
  private readonly options: LeaseManagerOptions
  /** documents that hold a stored lease: the only ones a renewal pass reads */
  private readonly trackedDocs = new Set<string>()
  /** Documents whose monotonic receipt anchor was captured in this process run */
  private readonly inProcessAnchored = new Set<string>()
  private readonly needsRefreshDocs = new Set<string>()
  private readonly revokedDocs = new Map<string, { leaseId?: string; userId?: string }>()
  /**
   * The clock verdicts of this run, kept even when the store refuses to
   * persist them: a detected rollback stays latched and the highest wall clock
   * seen never moves back until an online server-time check re-anchors it.
   */
  private readonly rollbackLatched = new Set<string>()
  private readonly wallSeen = new Map<string, number>()
  private readonly revokeListeners = new Set<(notice: LeaseRevokeNotice) => void>()
  private globalLockReason: LeaseLockReason | null = null
  /** `deployment/account#session` last seen; undefined = never looked */
  private lastBoundaryToken: string | null | undefined = undefined
  /** `deployment/account` of the last signed-in scope (survives a signed-out gap) */
  private lastStoreToken: string | null = null
  /** bumped by every lock and boundary change: an answer from before it is dropped */
  private generation = 0
  /** per document: the lease commits that landed, and the ones in flight (G703-R7-1) */
  private readonly commits = new Map<
    string,
    { landed: number; inFlight: number; waiters: Array<() => void> }
  >()

  constructor(options: LeaseManagerOptions) {
    this.options = options
    if (options.onRevoked) {
      this.revokeListeners.add(options.onRevoked)
    }
  }

  onRevoked(listener: (notice: LeaseRevokeNotice) => void): () => void {
    this.revokeListeners.add(listener)
    return () => this.revokeListeners.delete(listener)
  }

  private scopeToken(scope: StoreScope | null): string | null {
    return scope ? `${scope.deploymentId}/${scope.accountId}` : null
  }

  /**
   * Sign-out, a new sign-in (a new session, even of the same account), an
   * account or deployment switch: every in-memory verdict of the previous
   * boundary - a lock, a revoke, a clock anchor - is dropped. What a lease says
   * from then on comes from the store of the scope signed in now.
   */
  private checkScopeBoundary(): StoreScope | null {
    const scope = this.options.scope()
    const storeToken = this.scopeToken(scope)
    const token = storeToken === null ? null : `${storeToken}#${this.options.session() ?? ''}`
    if (this.lastBoundaryToken !== undefined && token !== this.lastBoundaryToken) {
      this.generation += 1
      this.globalLockReason = null
      this.inProcessAnchored.clear()
      this.needsRefreshDocs.clear()
      this.revokedDocs.clear()
      this.rollbackLatched.clear()
      this.wallSeen.clear()
      // the same account after a signed-out gap keeps its tracked leases
      if (storeToken !== null && storeToken !== this.lastStoreToken) this.trackedDocs.clear()
    }
    this.lastBoundaryToken = token
    if (storeToken !== null) this.lastStoreToken = storeToken
    return scope
  }

  /** the boundary lock that refuses grants and renewals, if one holds */
  private boundaryLockState(): LeaseEffectiveState | null {
    if (this.globalLockReason === null || !BOUNDARY_LOCKS.has(this.globalLockReason)) return null
    return makeState('locked', { reason: this.globalLockReason })
  }

  private isOnlineNow(): boolean {
    if (this.options.isOnline && !this.options.isOnline()) return false
    return this.options.client() !== null
  }

  private emitRevoke(notice: LeaseRevokeNotice): void {
    for (const listener of this.revokeListeners) {
      listener(notice)
    }
  }

  private buildRecordFromSdo(
    sdo: OfficeOfflineLeaseSDO,
    scope: StoreScope,
    previousMaxWallClock?: number,
    preservedVersion?: { version_id: string; version: number; revision: string },
  ): LeaseRecord {
    const anchors = anchorLeaseReceipt(sdo.server_time, this.options.clock, previousMaxWallClock)
    const record = parseLeaseRecord({
      schema: LEASE_RECORD_SCHEMA,
      lease: sdo.lease,
      lease_id: sdo.lease_id,
      generation: sdo.generation,
      issued_at: sdo.issued_at,
      expires_at: sdo.expires_at,
      renew_after: sdo.renew_after,
      level: sdo.level,
      version_id: preservedVersion?.version_id ?? sdo.version_id,
      version: preservedVersion?.version ?? sdo.version,
      revision: preservedVersion?.revision ?? sdo.revision,
      document_id: sdo.document_id,
      scope: {
        user_id: scope.accountId,
        deployment_id: scope.deploymentId,
        organization_id: sdo.organization_id,
        workspace_id: sdo.workspace_id,
      },
      ...anchors,
      policy_epoch: sdo.policy_epoch,
      revoked: false,
      archived: false,
    })
    if (!record) throw new Error('invalid lease record constructed from SDO')
    return record
  }

  async effectiveState(documentId: string): Promise<LeaseEffectiveState> {
    const scope = this.checkScopeBoundary()

    // No offline cold-login: no session -> no usable lease
    if (!scope) {
      return makeState('none')
    }

    if (this.globalLockReason !== null) {
      return makeState('locked', { reason: this.globalLockReason })
    }

    if (this.revokedDocs.has(documentId)) {
      return makeState('revoked', { reason: 'revoked' })
    }

    const read = await this.options.store.get(documentId)
    const unavailable = unavailableState(read)
    if (unavailable) return unavailable
    if (read.kind !== 'ok') {
      // no lease held: nothing for a renewal pass to read
      this.trackedDocs.delete(documentId)
      return makeState('none')
    }

    let record = read.record
    if (record.revoked === true) {
      this.trackedDocs.delete(documentId)
      this.revokedDocs.set(documentId, { leaseId: record.lease_id, userId: record.user_id })
      return makeState('revoked', { reason: 'revoked', record })
    }
    this.trackedDocs.add(documentId)

    const wallNow = this.options.clock.wallNow()
    const monoNow = this.options.clock.monotonicNow()
    const sameProcess = this.inProcessAnchored.has(documentId)

    // what this run already saw, even if the store refused to keep it
    const seen = this.wallSeen.get(documentId)
    if (seen !== undefined && seen > record.max_wall_clock_seen) {
      record = { ...record, max_wall_clock_seen: seen }
    }
    if (this.rollbackLatched.has(documentId)) {
      record = { ...record, clock_rollback: true }
    }

    const wallStep = advanceWallClock(record, wallNow)
    if (wallStep.changed) {
      record = wallStep.record
      // remembered first: a write the store refuses must not unlatch it
      this.wallSeen.set(documentId, record.max_wall_clock_seen)
      if (record.clock_rollback === true) this.rollbackLatched.add(documentId)
      const saved = await this.options.store.put(record)
      const unavailableSave = unavailableState(saved)
      if (unavailableSave) return unavailableSave
    }

    const evalResult = evaluateLeaseClock(record, {
      wallNow,
      monotonicNow: monoNow,
      sameProcess,
    })

    const needs_refresh = this.needsRefreshDocs.has(documentId)

    if (evalResult.state === 'clock_rollback') {
      return makeState('clock_rollback', {
        level: record.level,
        reason: 'clock_rollback',
        needs_refresh,
        record,
        remainingMs: 0,
      })
    }

    if (evalResult.state === 'expired') {
      return makeState('expired', {
        level: record.level,
        reason: 'lease_expired',
        needs_refresh,
        record,
        remainingMs: 0,
      })
    }

    return makeState(evalResult.state, {
      level: record.level,
      needs_refresh,
      record,
      remainingMs: evalResult.remainingMs,
    })
  }

  async grant(documentId: string): Promise<LeaseRenewResult> {
    const scope = this.checkScopeBoundary()
    if (!scope) {
      return { kind: 'none', state: await this.effectiveState(documentId) }
    }
    const locked = this.boundaryLockState()
    if (locked) return { kind: 'locked', state: locked }
    if (!this.isOnlineNow()) {
      return { kind: 'offline', state: await this.effectiveState(documentId) }
    }
    const client = this.options.client()
    if (!client) {
      return { kind: 'offline', state: await this.effectiveState(documentId) }
    }
    const generation = this.generation

    const existingRead = await this.options.store.get(documentId)
    const unavailable = unavailableResult(existingRead)
    if (unavailable) return unavailable
    const previousMaxWall =
      existingRead.kind === 'ok' ? existingRead.record.max_wall_clock_seen : undefined

    try {
      const sdo = await client.grant(documentId)
      return this.applyGrantedOrRenewedSdo(documentId, scope, generation, sdo, previousMaxWall)
    } catch (error) {
      return this.handleClientError(
        documentId,
        error,
        existingRead.kind === 'ok' ? existingRead.record : undefined,
        false,
        generation,
      )
    }
  }

  async renew(
    documentId: string,
    options: { force?: boolean; loadedVersionId?: string } = {},
  ): Promise<LeaseRenewResult> {
    const scope = this.checkScopeBoundary()
    if (!scope) {
      return { kind: 'none', state: await this.effectiveState(documentId) }
    }
    const locked = this.boundaryLockState()
    if (locked) return { kind: 'locked', state: locked }
    const generation = this.generation

    const existingRead = await this.options.store.get(documentId)
    const unavailable = unavailableResult(existingRead)
    if (unavailable) return unavailable
    if (existingRead.kind !== 'ok') {
      this.trackedDocs.delete(documentId)
      return { kind: 'none', state: await this.effectiveState(documentId) }
    }
    const current = existingRead.record
    if (current.revoked === true || this.revokedDocs.has(documentId)) {
      const state = await this.effectiveState(documentId)
      return { kind: 'revoked', state }
    }
    this.trackedDocs.add(documentId)
    if (current.archived === true) {
      const state = await this.effectiveState(documentId)
      return { kind: 'archived', record: current, state }
    }

    // Never renew offline (DOC-005 §6.2 row 2)
    if (!this.isOnlineNow()) {
      return { kind: 'offline', state: await this.effectiveState(documentId) }
    }
    const client = this.options.client()
    if (!client) {
      return { kind: 'offline', state: await this.effectiveState(documentId) }
    }

    const evalResult = evaluateLeaseClock(current, {
      wallNow: this.options.clock.wallNow(),
      monotonicNow: this.options.clock.monotonicNow(),
      sameProcess: this.inProcessAnchored.has(documentId),
    })

    if (!options.force && !evalResult.shouldRenew && !this.needsRefreshDocs.has(documentId)) {
      return { kind: 'not_due', state: await this.effectiveState(documentId) }
    }

    try {
      const sdo = await client.renew(documentId, current.lease)
      return this.applyGrantedOrRenewedSdo(
        documentId,
        scope,
        generation,
        sdo,
        current.max_wall_clock_seen,
        options.loadedVersionId ?? this.options.loadedVersionId?.(documentId) ?? current.version_id,
        current,
      )
    } catch (error) {
      return this.handleClientError(documentId, error, current, true, generation)
    }
  }

  /** an answer that arrived after a lock or a boundary change is dropped */
  private async staleResult(documentId: string): Promise<LeaseRenewResult> {
    const state = await this.effectiveState(documentId)
    return state.state === 'locked' ? { kind: 'locked', state } : { kind: 'none', state }
  }

  private async applyGrantedOrRenewedSdo(
    documentId: string,
    scope: StoreScope,
    generation: number,
    sdo: OfficeOfflineLeaseSDO,
    previousMaxWallClock?: number,
    loadedVersionId?: string,
    previousRecord?: LeaseRecord,
  ): Promise<LeaseRenewResult> {
    // a sign-out while the request was in flight: its answer must not unlock
    if (generation !== this.generation) return this.staleResult(documentId)

    const expectedVersionId =
      loadedVersionId ?? this.options.loadedVersionId?.(documentId) ?? sdo.version_id
    const versionMismatch = expectedVersionId !== sdo.version_id

    const record = this.buildRecordFromSdo(
      sdo,
      scope,
      previousMaxWallClock,
      versionMismatch && previousRecord
        ? {
            version_id: previousRecord.version_id,
            version: previousRecord.version,
            revision: previousRecord.revision,
          }
        : undefined,
    )

    const commit = this.commits.get(documentId) ?? { landed: 0, inFlight: 0, waiters: [] }
    this.commits.set(documentId, commit)
    commit.inFlight += 1
    let written: Awaited<ReturnType<typeof this.options.store.put>>
    try {
      written = await this.options.store.put(record)
    } finally {
      commit.inFlight -= 1
      commit.landed += 1
      if (commit.inFlight === 0) for (const wake of commit.waiters.splice(0)) wake()
    }
    const unavailable = unavailableResult(written)
    if (unavailable) return unavailable
    if (written.kind === 'store_full') {
      return { kind: 'store_full', state: await this.effectiveState(documentId) }
    }
    if (written.kind !== 'ok') {
      return {
        kind: 'failed',
        failure: { kind: 'server_error', code: written.kind },
        state: await this.effectiveState(documentId),
      }
    }
    if (generation !== this.generation) return this.staleResult(documentId)

    this.revokedDocs.delete(documentId)
    // a successful server round trip ends a session_expired lock
    if (this.globalLockReason === 'session_expired') this.globalLockReason = null
    this.trackedDocs.add(documentId)
    this.inProcessAnchored.add(documentId)
    // freshly anchored to the server: the run's clock verdicts start over
    this.rollbackLatched.delete(documentId)
    this.wallSeen.delete(documentId)

    if (versionMismatch) {
      this.needsRefreshDocs.add(documentId)
      return {
        kind: 'needs_refresh',
        documentId,
        loadedVersionId: expectedVersionId,
        headVersionId: sdo.version_id,
        headVersion: sdo.version,
        headRevision: sdo.revision,
        record: written.record,
        sdo,
      }
    }

    this.needsRefreshDocs.delete(documentId)
    const state = await this.effectiveState(documentId)
    return { kind: 'renewed', record: written.record, state }
  }

  private async handleClientError(
    documentId: string,
    error: unknown,
    currentRecord: LeaseRecord | undefined,
    allowSingleRegrant: boolean,
    generation: number,
  ): Promise<LeaseRenewResult> {
    const failure: LeaseFailure =
      error instanceof LeaseClientError
        ? error.failure
        : { kind: 'server_error', code: 'server_error' }

    if (generation !== this.generation) return this.staleResult(documentId)

    if (failure.kind === 'offline') {
      return { kind: 'offline', state: await this.effectiveState(documentId) }
    }

    if (failure.kind === 'session_expired') {
      this.lockAll('session_expired')
      this.options.onSessionExpired?.()
      return { kind: 'session_expired', state: await this.effectiveState(documentId) }
    }

    // DOC-005 §6.2 row 4: offline_lease_revoked on renew may be a signature/secret
    // rotation; re-grant once with an empty body while online, and if that also
    // fails -> revoked.
    if (failure.kind === 'revoked' && allowSingleRegrant && this.isOnlineNow()) {
      const client = this.options.client()
      const scope = this.options.scope()
      if (client && scope) {
        try {
          const regrantedSdo = await client.grant(documentId)
          return this.applyGrantedOrRenewedSdo(
            documentId,
            scope,
            generation,
            regrantedSdo,
            currentRecord?.max_wall_clock_seen,
            this.options.loadedVersionId?.(documentId) ?? currentRecord?.version_id,
            currentRecord,
          )
        } catch (regrantError) {
          return this.handleClientError(documentId, regrantError, currentRecord, false, generation)
        }
      }
    }

    if (failure.kind === 'revoked' || failure.kind === 'access_denied') {
      await this.markDocumentRevoked(documentId, {
        leaseId: currentRecord?.lease_id,
        userId: currentRecord?.user_id ?? this.options.scope()?.accountId,
        reason: failure.code,
        currentRecord,
      })
      return { kind: 'revoked', state: await this.effectiveState(documentId) }
    }

    // DOC-005 §6.2 row 14: document_archived keeps the existing lease until expiry, then locks
    if (failure.kind === 'archived' && currentRecord) {
      const archivedRecord: LeaseRecord = {
        ...currentRecord,
        archived: true,
        clock_rollback: false,
      }
      await this.options.store.put(archivedRecord)
      return {
        kind: 'archived',
        record: archivedRecord,
        state: await this.effectiveState(documentId),
      }
    }

    // DOC-005 §6.2 row 12: office_capability_off keeps existing lease until expiry
    if (failure.kind === 'capability_off') {
      return {
        kind: 'capability_off',
        state: await this.effectiveState(documentId),
      }
    }

    return {
      kind: 'failed',
      failure,
      state: await this.effectiveState(documentId),
    }
  }

  private async markDocumentRevoked(
    documentId: string,
    info: {
      leaseId?: string
      userId?: string
      reason: string
      currentRecord?: LeaseRecord
    },
  ): Promise<void> {
    this.trackedDocs.delete(documentId)
    this.needsRefreshDocs.delete(documentId)
    this.revokedDocs.set(documentId, { leaseId: info.leaseId, userId: info.userId })

    let existing = info.currentRecord
    if (!existing) {
      const read = await this.options.store.get(documentId)
      if (read.kind === 'ok') existing = read.record
    }
    if (existing) {
      await this.options.store.put({
        ...existing,
        revoked: true,
      })
    }

    this.emitRevoke({
      documentId,
      ...(info.leaseId ? { leaseId: info.leaseId } : {}),
      ...(info.userId ? { userId: info.userId } : {}),
      reason: info.reason,
      deleteCommittedCache: true,
      keepDrafts: true,
    })
  }

  /**
   * The one entry point for the `office_lease.revoked` event (payload carries
   * ids only: `user_id`, `document_id`, `lease_id`; DOC-005 row 16 / §6.2.2).
   * Locks the document's lease at once and emits the committed-cache deletion
   * notice (drafts kept). Only an event for the signed-in user is applied, and
   * only when no lease is held for the document or the held one is the lease
   * named; another user's, one without a session, one naming a lease other
   * than the held one, or a malformed payload is ignored (null).
   *
   * Gap (R1BE-5): no producer calls this yet. The server publishes the event on
   * the user-scope outbox/realtime channel, and the desktop shell has no client
   * for it (the document feed carries document changes only). Until that
   * client exists, a revoke reaches the app on the next online renewal
   * (403 `offline_lease_revoked`, rows 4/15).
   */
  async handleFeedRevoked(payload: unknown): Promise<LeaseEffectiveState | null> {
    const event = parseLeaseRevokedEvent(payload)
    if (!event) return null
    const scope = this.checkScopeBoundary()
    if (!scope || event.user_id !== scope.accountId) return null
    const existingRead = await this.options.store.get(event.document_id)
    const currentRecord = existingRead.kind === 'ok' ? existingRead.record : undefined
    if (currentRecord && currentRecord.user_id !== event.user_id) return null
    // a late event for an older lease: the lease held now is a newer grant the
    // server still considers live (R2BE-4); the next online pass settles it
    if (currentRecord && currentRecord.lease_id !== event.lease_id) return null

    await this.markDocumentRevoked(event.document_id, {
      leaseId: event.lease_id,
      userId: event.user_id,
      reason: 'office_lease.revoked',
      currentRecord,
    })
    return this.effectiveState(event.document_id)
  }

  /**
   * Clears a `clock_rollback` state on a lease after a successful online
   * server-time check and re-anchors monotonic + wall clocks.
   */
  async onOnlineServerTimeCheck(
    documentId: string,
    serverTime: string | number,
  ): Promise<LeaseEffectiveState> {
    const read = await this.options.store.get(documentId)
    if (read.kind !== 'ok') {
      return this.effectiveState(documentId)
    }
    const updated = applyOnlineServerTimeCheck(read.record, serverTime, this.options.clock)
    const written = await this.options.store.put(updated)
    const unavailable = unavailableState(written)
    if (unavailable) return unavailable
    this.rollbackLatched.delete(documentId)
    this.wallSeen.delete(documentId)
    this.inProcessAnchored.add(documentId)
    return this.effectiveState(documentId)
  }

  /**
   * G703-R7-1: a stamp of the lease commits of `documentId`. It changes when a
   * granted/renewed lease starts to be written and again when the write lands,
   * and is odd while one is in flight - so a caller that decided on an older
   * read of the lease (the offline copy's expiry lock) can tell it went stale.
   */
  commitStamp(documentId: string): number {
    const commit = this.commits.get(documentId)
    if (!commit) return 0
    return commit.landed * 2 + (commit.inFlight > 0 ? 1 : 0)
  }

  /** G703-R7-1: resolves once no lease commit of the document is in flight (at once when none is) */
  commitSettled(documentId: string): Promise<void> {
    const commit = this.commits.get(documentId)
    if (!commit || commit.inFlight === 0) return Promise.resolve()
    return new Promise<void>((resolve) => commit.waiters.push(resolve))
  }

  /**
   * Startup pass: when online, renews any held/supplied leases that have
   * < 50 % of their TTL remaining.
   */
  async onStartup(documentIds?: Iterable<string>): Promise<Map<string, LeaseRenewResult>> {
    return this.renewDueLeases(documentIds)
  }

  /**
   * Reconnect pass: when online, renews any held/supplied leases that have
   * < 50 % of their TTL remaining.
   */
  async onReconnect(documentIds?: Iterable<string>): Promise<Map<string, LeaseRenewResult>> {
    return this.renewDueLeases(documentIds)
  }

  /**
   * Called by `SyncRuntime` after every poll pass with the pass's
   * connectivity verdict: each online pass (the sign-in pass, every interval
   * tick, the first one after a reconnect) renews the held leases that are
   * due; a lease that is not due costs a store read and no request. An offline
   * pass, or one with no verdict, sends nothing at all.
   */
  async onOnlinePass(online: boolean | undefined): Promise<void> {
    if (online !== true) return
    await this.renewDueLeases()
  }

  private async renewDueLeases(
    documentIds?: Iterable<string>,
  ): Promise<Map<string, LeaseRenewResult>> {
    const results = new Map<string, LeaseRenewResult>()
    this.checkScopeBoundary()
    if (!this.isOnlineNow() || this.boundaryLockState()) return results

    const ids = new Set<string>(this.trackedDocs)
    if (documentIds) {
      for (const id of documentIds) ids.add(id)
    }

    const gen = this.generation
    for (const docId of ids) {
      if (this.generation !== gen || !this.isOnlineNow()) break
      const res = await this.renew(docId)
      results.set(docId, res)
    }
    return results
  }

  async release(documentId: string): Promise<void> {
    this.trackedDocs.delete(documentId)
    this.inProcessAnchored.delete(documentId)
    this.needsRefreshDocs.delete(documentId)
    this.revokedDocs.delete(documentId)
    this.rollbackLatched.delete(documentId)
    this.wallSeen.delete(documentId)
    await this.options.store.delete(documentId)
    if (this.isOnlineNow()) {
      const client = this.options.client()
      if (client) {
        await client.release(documentId).catch(() => undefined)
      }
    }
  }

  /**
   * Locks every lease of the current session at once, synchronously, without
   * waiting for the server (sign-out, session expiry, a session lock). Only a
   * sign-out fires a best-effort DELETE per held lease, in the background and
   * never awaited; nothing is revoked and no cache-deletion notice is emitted.
   * The lock lasts until the session changes (a new sign-in starts unlocked).
   */
  lockAll(reason: LeaseLockReason = 'signed_out'): void {
    this.checkScopeBoundary()
    const docs = [...this.trackedDocs]
    const client = reason === 'signed_out' && this.isOnlineNow() ? this.options.client() : null
    this.generation += 1
    this.globalLockReason = reason
    this.inProcessAnchored.clear()
    this.needsRefreshDocs.clear()
    if (client) {
      for (const docId of docs) {
        void client.release(docId).catch(() => undefined)
      }
    }
  }

  /**
   * The account boundary (sign-out, account switch, deployment switch).
   * `owner` is the scope that is leaving. A sign-out (no scope left, or the
   * same one still signed in while it signs out) locks every lease at once as
   * `signed_out`. A switch drops the outgoing scope's state - its leases are
   * never served to the incoming scope - and neither locks the incoming one
   * nor sends a DELETE with its token. Returns the boundary crossed.
   */
  lockBoundary(owner: StoreScope | null): LeaseLockReason {
    const reason = boundaryLockReason(owner, this.options.scope())
    if (reason === 'signed_out') {
      this.lockAll('signed_out')
    } else {
      this.checkScopeBoundary()
    }
    return reason
  }

  logout(): void {
    this.lockAll('signed_out')
  }
}

export function createLeaseManager(options: LeaseManagerOptions): LeaseManager {
  return new LeaseManager(options)
}
