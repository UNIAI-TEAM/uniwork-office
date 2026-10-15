import type { LeaseRecord } from './record'

/**
 * Offline lease clock (DOC-005 §6.2 row 13, row 2).
 *
 * - While the process lives (`sameProcess !== false`), effective time is
 *   anchored to the server's clock at receipt plus monotonic elapsed time:
 *   `effective_now = server_time_at_receipt + (monotonic_now - monotonic_at_receipt)`.
 * - Across process restarts (`sameProcess === false`), the monotonic clock has
 *   reset, so `effective_now` uses the wall clock while persisting
 *   `max_wall_clock_seen`.
 * - If the wall clock is more than 5 minutes behind `max_wall_clock_seen`, the
 *   lease enters `clock_rollback` (locked as expired) and stays latched until a
 *   successful online server-time check clears it.
 */

export const CLOCK_ROLLBACK_MAX_DRIFT_MS = 5 * 60 * 1000
export const LEASE_EXPIRING_SOON_MS = 4 * 60 * 60 * 1000
export const LEASE_MAX_TTL_MS = 24 * 60 * 60 * 1000
export const LEASE_RENEW_THRESHOLD_RATIO = 0.5

export interface LeaseClockSource {
  wallNow(): number
  monotonicNow(): number
}

export type LeaseClockState = 'valid' | 'expiring_soon' | 'expired' | 'clock_rollback'

export interface LeaseClockEvaluation {
  state: LeaseClockState
  reason?: 'lease_expired' | 'clock_rollback'
  effectiveNow: number
  expiresAtMs: number
  renewAfterMs: number
  remainingMs: number
  shouldRenew: boolean
  maxWallClockSeen: number
  clockRollback: boolean
}

export interface LeaseClockOptions {
  wallNow: number
  monotonicNow?: number
  /**
   * True when `monotonic_at_receipt` was captured in this process run.
   * False when evaluating a persisted record loaded after a process restart.
   */
  sameProcess?: boolean
}

function parseMs(isoOrMs: string | number): number {
  if (typeof isoOrMs === 'number') {
    if (!Number.isFinite(isoOrMs)) throw new Error('invalid timestamp')
    return isoOrMs
  }
  const parsed = Date.parse(isoOrMs)
  if (!Number.isFinite(parsed)) throw new Error('invalid timestamp')
  return parsed
}

export function computeEffectiveNow(record: LeaseRecord, options: LeaseClockOptions): number {
  const inProcess =
    options.sameProcess !== false &&
    typeof options.monotonicNow === 'number' &&
    Number.isFinite(options.monotonicNow) &&
    options.monotonicNow >= record.monotonic_at_receipt

  if (inProcess && options.monotonicNow !== undefined) {
    return record.server_time_at_receipt + (options.monotonicNow - record.monotonic_at_receipt)
  }
  return options.wallNow
}

export function isClockRollback(record: LeaseRecord, wallNow: number): boolean {
  if (record.clock_rollback === true) return true
  return wallNow < record.max_wall_clock_seen - CLOCK_ROLLBACK_MAX_DRIFT_MS
}

export function evaluateLeaseClock(
  record: LeaseRecord,
  options: LeaseClockOptions,
): LeaseClockEvaluation {
  const expiresAtMs = Date.parse(record.expires_at)
  const renewAfterMs = Date.parse(record.renew_after)
  const issuedAtMs =
    record.issued_at !== undefined ? Date.parse(record.issued_at) : record.server_time_at_receipt
  const effectiveNow = computeEffectiveNow(record, options)
  const rollback = isClockRollback(record, options.wallNow)
  const maxWallClockSeen = Math.max(record.max_wall_clock_seen, options.wallNow)
  const remainingMs = Math.max(0, expiresAtMs - effectiveNow)

  // TTL is 2 * (expires_at - renew_after) when renew_after is the server's midpoint,
  // or (expires_at - issued_at) otherwise. Renew when < 50% of TTL remains.
  const totalTtlMs =
    expiresAtMs > renewAfterMs
      ? (expiresAtMs - renewAfterMs) * 2
      : Math.max(0, expiresAtMs - issuedAtMs)
  const shouldRenew =
    effectiveNow > renewAfterMs || remainingMs < totalTtlMs * LEASE_RENEW_THRESHOLD_RATIO

  if (rollback) {
    return {
      state: 'clock_rollback',
      reason: 'clock_rollback',
      effectiveNow,
      expiresAtMs,
      renewAfterMs,
      remainingMs,
      shouldRenew: true,
      maxWallClockSeen: record.max_wall_clock_seen,
      clockRollback: true,
    }
  }

  if (effectiveNow >= expiresAtMs) {
    return {
      state: 'expired',
      reason: 'lease_expired',
      effectiveNow,
      expiresAtMs,
      renewAfterMs,
      remainingMs: 0,
      shouldRenew: true,
      maxWallClockSeen,
      clockRollback: false,
    }
  }

  if (remainingMs < LEASE_EXPIRING_SOON_MS) {
    return {
      state: 'expiring_soon',
      effectiveNow,
      expiresAtMs,
      renewAfterMs,
      remainingMs,
      shouldRenew,
      maxWallClockSeen,
      clockRollback: false,
    }
  }

  return {
    state: 'valid',
    effectiveNow,
    expiresAtMs,
    renewAfterMs,
    remainingMs,
    shouldRenew,
    maxWallClockSeen,
    clockRollback: false,
  }
}

export function anchorLeaseReceipt(
  serverTime: string | number,
  clock: LeaseClockSource,
  previousMaxWallClock?: number,
): {
  server_time_at_receipt: number
  monotonic_at_receipt: number
  max_wall_clock_seen: number
  clock_rollback: false
} {
  const serverTimeMs = parseMs(serverTime)
  const wallNow = clock.wallNow()
  const monotonicNow = clock.monotonicNow()
  const maxWall =
    previousMaxWallClock !== undefined ? Math.max(previousMaxWallClock, wallNow) : wallNow
  return {
    server_time_at_receipt: serverTimeMs,
    monotonic_at_receipt: monotonicNow,
    max_wall_clock_seen: maxWall,
    clock_rollback: false,
  }
}

export function advanceWallClock(
  record: LeaseRecord,
  wallNow: number,
): { record: LeaseRecord; changed: boolean; rollback: boolean } {
  if (wallNow < record.max_wall_clock_seen - CLOCK_ROLLBACK_MAX_DRIFT_MS) {
    if (record.clock_rollback === true) {
      return { record, changed: false, rollback: true }
    }
    return {
      record: { ...record, clock_rollback: true },
      changed: true,
      rollback: true,
    }
  }
  if (record.clock_rollback === true) {
    return { record, changed: false, rollback: true }
  }
  if (wallNow > record.max_wall_clock_seen) {
    return {
      record: { ...record, max_wall_clock_seen: wallNow },
      changed: true,
      rollback: false,
    }
  }
  return { record, changed: false, rollback: false }
}

/**
 * Clears a `clock_rollback` state after a successful online server-time check
 * and re-anchors the lease to the fresh server time and current monotonic/wall clocks.
 */
export function applyOnlineServerTimeCheck(
  record: LeaseRecord,
  serverTime: string | number,
  clock: LeaseClockSource,
): LeaseRecord {
  const serverTimeMs = parseMs(serverTime)
  const wallNow = clock.wallNow()
  const monotonicNow = clock.monotonicNow()
  return {
    ...record,
    server_time_at_receipt: serverTimeMs,
    monotonic_at_receipt: monotonicNow,
    max_wall_clock_seen: wallNow,
    clock_rollback: false,
  }
}
