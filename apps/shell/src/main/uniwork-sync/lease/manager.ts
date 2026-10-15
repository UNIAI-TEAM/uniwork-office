import type { StoreScope } from '../keys'
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
import {
  LEASE_RECORD_SCHEMA,
  parseLeaseRecord,
  type LeaseLevel,
  type LeaseRecord,
} from './record'
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
 * - 401/403 session -> lock at once.
 * - Logout / account switch / deployment switch -> `lockAll(reason)` locks all
 *   leases at once without waiting for the server; no offline cold-login
 *   (no session -> no usable lease).
 */

export type LeaseEffectiveStateKind =
  | 'valid'
  | 'expiring_soon'
  | 'expired'
  | 'clock_rollback'
  | 'revoked'
  | 'keystore_locked'
  | 'none'

export type LeaseLockReason =
  | 'logout'
  | 'account_switch'
  | 'deployment_switch'
  | 'session_expired'
  | 'keystore_locked'
  | 'revoked'

export interface LeaseEffectiveState {
  state: LeaseEffectiveStateKind
  kind: LeaseEffectiveStateKind
  level: LeaseLevel | null
  locked: boolean
  usable: boolean
  reason?: 'lease_expired' | 'clock_rollback' | 'keystore_locked' | 'revoked'
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
  | { kind: 'keystore_locked'; state: LeaseEffectiveState }
  | { kind: 'session_expired'; state: LeaseEffectiveState }
  | { kind: 'none'; state: LeaseEffectiveState }
  | { kind: 'failed'; failure: LeaseFailure; state: LeaseEffectiveState }

export interface LeaseManagerOptions {
  store: LeaseStore
  client: () => LeaseClient | null
  clock: LeaseClockSource
  scope: () => StoreScope | null
  isOnline?: () => boolean
  loadedVersionId?: (documentId: string) => string | null | undefined
  onRevoked?: (notice: LeaseRevokeNotice) => void
  onSessionExpired?: () => void
}

function makeState(
  state: LeaseEffectiveStateKind,
  extra: {
    level?: LeaseLevel | null
    reason?: 'lease_expired' | 'clock_rollback' | 'keystore_locked' | 'revoked'
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
    state === 'keystore_locked'
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

export class LeaseManager {
  private readonly options: LeaseManagerOptions
  private readonly trackedDocs = new Set<string>()
  /** Documents whose monotonic receipt anchor was captured in this process run */
  private readonly inProcessAnchored = new Set<string>()
  private readonly needsRefreshDocs = new Set<string>()
  private readonly revokedDocs = new Map<string, { leaseId?: string; userId?: string }>()
  private readonly revokeListeners = new Set<(notice: LeaseRevokeNotice) => void>()
  private globalLockReason: LeaseLockReason | null = null
  private lastScopeToken: string | null = null
  private wasOnline = false
  private generation = 0

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

  private checkScopeBoundary(): StoreScope | null {
    const scope = this.options.scope()
    const token = this.scopeToken(scope)
    if (this.lastScopeToken !== null && token !== this.lastScopeToken) {
      // Account or deployment switched or signed out: lock previous scope's in-memory state immediately
      this.generation += 1
      this.inProcessAnchored.clear()
      this.needsRefreshDocs.clear()
      if (token !== null) {
        // Switched to a new account/deployment
        this.globalLockReason = null
        this.revokedDocs.clear()
        this.trackedDocs.clear()
      }
    }
    if (token !== null) {
      this.lastScopeToken = token
    }
    return scope
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
    this.trackedDocs.add(documentId)
    const scope = this.checkScopeBoundary()

    if (this.globalLockReason === 'keystore_locked') {
      return makeState('keystore_locked', { reason: 'keystore_locked' })
    }
    if (this.globalLockReason !== null) {
      return makeState('revoked', { reason: 'revoked' })
    }

    // No offline cold-login: no session -> no usable lease
    if (!scope) {
      return makeState('none')
    }

    if (this.revokedDocs.has(documentId)) {
      return makeState('revoked', { reason: 'revoked' })
    }

    const read = await this.options.store.get(documentId)
    if (read.kind === 'keystore_locked') {
      return makeState('keystore_locked', { reason: 'keystore_locked' })
    }
    if (read.kind === 'missing' || read.kind === 'refused') {
      return makeState('none')
    }

    let record = read.record
    if (record.revoked === true) {
      this.revokedDocs.set(documentId, { leaseId: record.lease_id, userId: record.user_id })
      return makeState('revoked', { reason: 'revoked', record })
    }

    const wallNow = this.options.clock.wallNow()
    const monoNow = this.options.clock.monotonicNow()
    const sameProcess = this.inProcessAnchored.has(documentId)

    const wallStep = advanceWallClock(record, wallNow)
    if (wallStep.changed) {
      record = wallStep.record
      const saved = await this.options.store.put(record)
      if (saved.kind === 'keystore_locked') {
        return makeState('keystore_locked', { reason: 'keystore_locked' })
      }
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
    this.trackedDocs.add(documentId)
    const scope = this.checkScopeBoundary()
    if (!scope) {
      return { kind: 'none', state: await this.effectiveState(documentId) }
    }
    if (!this.isOnlineNow()) {
      return { kind: 'offline', state: await this.effectiveState(documentId) }
    }
    const client = this.options.client()
    if (!client) {
      return { kind: 'offline', state: await this.effectiveState(documentId) }
    }

    const existingRead = await this.options.store.get(documentId)
    if (existingRead.kind === 'keystore_locked') {
      const state = makeState('keystore_locked', { reason: 'keystore_locked' })
      return { kind: 'keystore_locked', state }
    }
    const previousMaxWall =
      existingRead.kind === 'ok' ? existingRead.record.max_wall_clock_seen : undefined

    try {
      const sdo = await client.grant(documentId)
      return this.applyGrantedOrRenewedSdo(documentId, scope, sdo, previousMaxWall)
    } catch (error) {
      return this.handleClientError(
        documentId,
        error,
        existingRead.kind === 'ok' ? existingRead.record : undefined,
        false,
      )
    }
  }

  async renew(
    documentId: string,
    options: { force?: boolean; loadedVersionId?: string } = {},
  ): Promise<LeaseRenewResult> {
    this.trackedDocs.add(documentId)
    const scope = this.checkScopeBoundary()
    if (!scope) {
      return { kind: 'none', state: await this.effectiveState(documentId) }
    }

    const existingRead = await this.options.store.get(documentId)
    if (existingRead.kind === 'keystore_locked') {
      const state = makeState('keystore_locked', { reason: 'keystore_locked' })
      return { kind: 'keystore_locked', state }
    }
    if (existingRead.kind !== 'ok') {
      return { kind: 'none', state: await this.effectiveState(documentId) }
    }
    const current = existingRead.record
    if (current.revoked === true || this.revokedDocs.has(documentId)) {
      const state = await this.effectiveState(documentId)
      return { kind: 'revoked', state }
    }
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
        sdo,
        current.max_wall_clock_seen,
        options.loadedVersionId ?? this.options.loadedVersionId?.(documentId) ?? current.version_id,
        current,
      )
    } catch (error) {
      return this.handleClientError(documentId, error, current, true)
    }
  }

  private async applyGrantedOrRenewedSdo(
    documentId: string,
    scope: StoreScope,
    sdo: OfficeOfflineLeaseSDO,
    previousMaxWallClock?: number,
    loadedVersionId?: string,
    previousRecord?: LeaseRecord,
  ): Promise<LeaseRenewResult> {
    this.revokedDocs.delete(documentId)
    this.globalLockReason = null

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

    const written = await this.options.store.put(record)
    if (written.kind === 'keystore_locked') {
      const state = makeState('keystore_locked', { reason: 'keystore_locked' })
      return { kind: 'keystore_locked', state }
    }
    if (written.kind !== 'ok') {
      return {
        kind: 'failed',
        failure: { kind: 'server_error', code: written.kind },
        state: await this.effectiveState(documentId),
      }
    }

    this.inProcessAnchored.add(documentId)

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
  ): Promise<LeaseRenewResult> {
    const failure: LeaseFailure =
      error instanceof LeaseClientError
        ? error.failure
        : { kind: 'server_error', code: 'server_error' }

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
            regrantedSdo,
            currentRecord?.max_wall_clock_seen,
            this.options.loadedVersionId?.(documentId) ?? currentRecord?.version_id,
            currentRecord,
          )
        } catch (regrantError) {
          return this.handleClientError(documentId, regrantError, currentRecord, false)
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
    this.trackedDocs.add(documentId)
    this.needsRefreshDocs.delete(documentId)
    this.revokedDocs.set(documentId, { leaseId: info.leaseId, userId: info.userId })

    const existing =
      info.currentRecord ??
      ((await this.options.store.get(documentId)) as { kind: string; record?: LeaseRecord }).record
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
   * Handles feed / outbox event `office_lease.revoked` (payload carries ids only:
   * `user_id`, `document_id`, `lease_id`). Locks the document's lease at once
   * and emits the committed-cache deletion notice (drafts kept).
   */
  async handleFeedRevoked(payload: LeaseRevokedEventPayload): Promise<LeaseEffectiveState> {
    const scope = this.checkScopeBoundary()
    if (scope && payload.user_id !== scope.accountId) {
      return this.effectiveState(payload.document_id)
    }
    const existingRead = await this.options.store.get(payload.document_id)
    const currentRecord = existingRead.kind === 'ok' ? existingRead.record : undefined
    if (currentRecord && currentRecord.user_id !== payload.user_id) {
      return this.effectiveState(payload.document_id)
    }

    await this.markDocumentRevoked(payload.document_id, {
      leaseId: payload.lease_id,
      userId: payload.user_id,
      reason: 'office_lease.revoked',
      currentRecord,
    })
    return this.effectiveState(payload.document_id)
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
    if (written.kind === 'keystore_locked') {
      return makeState('keystore_locked', { reason: 'keystore_locked' })
    }
    this.inProcessAnchored.add(documentId)
    return this.effectiveState(documentId)
  }

  /**
   * Startup pass: when online, renews any tracked/supplied leases that have
   * < 50 % of their TTL remaining.
   */
  async onStartup(documentIds?: Iterable<string>): Promise<Map<string, LeaseRenewResult>> {
    this.wasOnline = this.isOnlineNow()
    return this.renewDueLeases(documentIds)
  }

  /**
   * Reconnect pass: when online, renews any tracked/supplied leases that have
   * < 50 % of their TTL remaining.
   */
  async onReconnect(documentIds?: Iterable<string>): Promise<Map<string, LeaseRenewResult>> {
    this.wasOnline = this.isOnlineNow()
    return this.renewDueLeases(documentIds)
  }

  /**
   * Called by `SyncRuntime` on poll passes: runs startup/reconnect renewal
   * when online connectivity is first established or restored.
   */
  async onOnlinePass(online: boolean | undefined): Promise<void> {
    if (online === undefined) return
    const previouslyOnline = this.wasOnline
    this.wasOnline = online
    if (online && !previouslyOnline) {
      await this.renewDueLeases()
    }
  }

  private async renewDueLeases(
    documentIds?: Iterable<string>,
  ): Promise<Map<string, LeaseRenewResult>> {
    const results = new Map<string, LeaseRenewResult>()
    if (!this.isOnlineNow()) return results

    const ids = new Set<string>(this.trackedDocs)
    if (documentIds) {
      for (const id of documentIds) {
        ids.add(id)
        this.trackedDocs.add(id)
      }
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
    await this.options.store.delete(documentId)
    if (this.isOnlineNow()) {
      const client = this.options.client()
      if (client) {
        await client.release(documentId).catch(() => undefined)
      }
    }
  }

  /**
   * Locks every lease at once synchronously without waiting for the server
   * (logout, account switch, deployment switch, session expiry, or session lock).
   */
  lockAll(reason: LeaseLockReason = 'logout'): void {
    this.generation += 1
    this.globalLockReason = reason
    this.inProcessAnchored.clear()
    this.needsRefreshDocs.clear()
    if (reason !== 'keystore_locked') {
      const docs = [...this.trackedDocs]
      for (const docId of docs) {
        this.revokedDocs.set(docId, {})
      }
      // Best-effort server release in background if a client is available
      const client = this.options.client()
      if (client && this.isOnlineNow()) {
        for (const docId of docs) {
          void client.release(docId).catch(() => undefined)
        }
      }
    }
  }

  logout(): void {
    this.lockAll('logout')
  }
}

export function createLeaseManager(options: LeaseManagerOptions): LeaseManager {
  return new LeaseManager(options)
}
