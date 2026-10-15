import { describe, expect, it } from 'vitest'
import {
  CLOCK_ROLLBACK_MAX_DRIFT_MS,
  advanceWallClock,
  anchorLeaseReceipt,
  applyOnlineServerTimeCheck,
  computeEffectiveNow,
  evaluateLeaseClock,
  isClockRollback,
} from '../src/main/uniwork-sync/lease/clock'
import { parseLeaseRecord, type LeaseRecord } from '../src/main/uniwork-sync/lease/record'

const T0 = Date.parse('2026-10-13T08:00:00Z')
const HOUR = 60 * 60 * 1000
const MIN = 60 * 1000

function makeRecord(overrides: Partial<LeaseRecord> = {}): LeaseRecord {
  const record = parseLeaseRecord({
    schema: 1,
    lease: 'ofl1.eyJ2IjoxfQ.sig',
    lease_id: '01J8X4LEASE1P2Q3R4S5T6U7V8',
    generation: 1,
    issued_at: new Date(T0).toISOString(),
    expires_at: new Date(T0 + 24 * HOUR).toISOString(),
    renew_after: new Date(T0 + 12 * HOUR).toISOString(),
    level: 'edit',
    version_id: 'ver_1',
    version: 1,
    revision: '10',
    document_id: 'doc_1',
    scope: {
      user_id: 'user_1',
      deployment_id: 'dep_1',
      organization_id: 'org_1',
      workspace_id: 'ws_1',
    },
    server_time_at_receipt: T0,
    monotonic_at_receipt: 1_000,
    max_wall_clock_seen: T0,
    ...overrides,
  })
  if (!record) throw new Error('invalid test record')
  return record
}

describe('uniwork-sync lease clock (G5-08c)', () => {
  it('clock rollback > 5 min locks, < 5 min does not, online check clears it', () => {
    const initial = makeRecord({
      server_time_at_receipt: T0,
      monotonic_at_receipt: 1_000,
      max_wall_clock_seen: T0 + 30 * MIN,
    })

    // 1. Wall clock 4 minutes behind max_wall_clock_seen (<= 5 min tolerance) does NOT lock
    const minorDriftWall = T0 + 26 * MIN
    expect(isClockRollback(initial, minorDriftWall)).toBe(false)
    const minorStep = advanceWallClock(initial, minorDriftWall)
    expect(minorStep.rollback).toBe(false)
    const minorEval = evaluateLeaseClock(minorStep.record, {
      wallNow: minorDriftWall,
      monotonicNow: 1_000 + 30 * MIN,
      sameProcess: true,
    })
    expect(minorEval.state).toBe('valid')
    expect(minorEval.clockRollback).toBe(false)

    // 2. Exact 5 min boundary does NOT lock
    const boundaryWall = initial.max_wall_clock_seen - CLOCK_ROLLBACK_MAX_DRIFT_MS
    expect(isClockRollback(initial, boundaryWall)).toBe(false)

    // 3. Wall clock > 5 min behind max_wall_clock_seen (e.g., 5 min + 1 ms back) locks as clock_rollback
    const rolledBackWall = initial.max_wall_clock_seen - CLOCK_ROLLBACK_MAX_DRIFT_MS - 1
    expect(isClockRollback(initial, rolledBackWall)).toBe(true)
    const rolledStep = advanceWallClock(initial, rolledBackWall)
    expect(rolledStep.rollback).toBe(true)
    expect(rolledStep.record.clock_rollback).toBe(true)
    // max_wall_clock_seen is preserved when rolling back
    expect(rolledStep.record.max_wall_clock_seen).toBe(T0 + 30 * MIN)

    const rolledEval = evaluateLeaseClock(rolledStep.record, {
      wallNow: rolledBackWall,
      monotonicNow: 1_000 + 30 * MIN,
      sameProcess: true,
    })
    expect(rolledEval.state).toBe('clock_rollback')
    expect(rolledEval.reason).toBe('clock_rollback')
    expect(rolledEval.clockRollback).toBe(true)

    // Even if wall clock later creeps past max_wall_clock_seen while still offline,
    // the latched clock_rollback stays locked until an online server-time check
    const offlineLater = advanceWallClock(rolledStep.record, T0 + 35 * MIN)
    expect(offlineLater.rollback).toBe(true)
    expect(
      evaluateLeaseClock(offlineLater.record, {
        wallNow: T0 + 35 * MIN,
        monotonicNow: 1_000 + 35 * MIN,
        sameProcess: true,
      }).state,
    ).toBe('clock_rollback')

    // 4. Online server-time check clears clock_rollback and re-anchors monotonic + wall clock
    const cleared = applyOnlineServerTimeCheck(
      offlineLater.record,
      new Date(T0 + 40 * MIN).toISOString(),
      {
        wallNow: () => rolledBackWall,
        monotonicNow: () => 50_000,
      },
    )
    expect(cleared.clock_rollback).toBe(false)
    expect(cleared.server_time_at_receipt).toBe(T0 + 40 * MIN)
    expect(cleared.monotonic_at_receipt).toBe(50_000)
    expect(cleared.max_wall_clock_seen).toBe(rolledBackWall)

    const afterClearEval = evaluateLeaseClock(cleared, {
      wallNow: rolledBackWall,
      monotonicNow: 50_000,
      sameProcess: true,
    })
    expect(afterClearEval.state).toBe('valid')
    expect(afterClearEval.clockRollback).toBe(false)
  })

  it('offline expiry -> expired', () => {
    const record = makeRecord({
      server_time_at_receipt: T0,
      monotonic_at_receipt: 1_000,
      max_wall_clock_seen: T0,
    })

    // 1 ms before 24h expiry -> expiring_soon, not expired
    const justBefore = evaluateLeaseClock(record, {
      wallNow: T0 + 24 * HOUR - 1,
      monotonicNow: 1_000 + 24 * HOUR - 1,
      sameProcess: true,
    })
    expect(justBefore.state).toBe('expiring_soon')
    expect(justBefore.remainingMs).toBe(1)

    // At 24h expiry -> expired (reason lease_expired)
    const atExpiry = evaluateLeaseClock(record, {
      wallNow: T0 + 24 * HOUR,
      monotonicNow: 1_000 + 24 * HOUR,
      sameProcess: true,
    })
    expect(atExpiry.state).toBe('expired')
    expect(atExpiry.reason).toBe('lease_expired')
    expect(atExpiry.remainingMs).toBe(0)

    // Across process restart (monotonic reset, using wall clock) past expiry -> expired
    const restartedPastExpiry = evaluateLeaseClock(record, {
      wallNow: T0 + 25 * HOUR,
      sameProcess: false,
    })
    expect(restartedPastExpiry.state).toBe('expired')
    expect(restartedPastExpiry.reason).toBe('lease_expired')
  })

  it('effective expiry from server time + monotonic clock while the process lives, and wall clock with max_wall_clock_seen across restarts', () => {
    // Client wall clock is 2 hours behind server time at receipt, but monotonic clock tracks elapsed time
    const clientWallAtReceipt = T0 - 2 * HOUR
    const anchors = anchorLeaseReceipt(new Date(T0).toISOString(), {
      wallNow: () => clientWallAtReceipt,
      monotonicNow: () => 5_000,
    })
    const record = makeRecord(anchors)

    // 24 hours of monotonic time pass: even though client wall clock is only T0 + 22h,
    // effective_now is T0 + 24h so the lease expires on server time + monotonic delta
    const effective = computeEffectiveNow(record, {
      wallNow: clientWallAtReceipt + 24 * HOUR,
      monotonicNow: 5_000 + 24 * HOUR,
      sameProcess: true,
    })
    expect(effective).toBe(T0 + 24 * HOUR)
    const inProcessEval = evaluateLeaseClock(record, {
      wallNow: clientWallAtReceipt + 24 * HOUR,
      monotonicNow: 5_000 + 24 * HOUR,
      sameProcess: true,
    })
    expect(inProcessEval.state).toBe('expired')
    expect(inProcessEval.reason).toBe('lease_expired')

    // Across restart (sameProcess = false), effective_now uses wallNow and checks max_wall_clock_seen
    const afterAdvance = advanceWallClock(record, T0 + 10 * HOUR)
    expect(afterAdvance.record.max_wall_clock_seen).toBe(T0 + 10 * HOUR)
    expect(
      computeEffectiveNow(afterAdvance.record, {
        wallNow: T0 + 11 * HOUR,
        sameProcess: false,
      }),
    ).toBe(T0 + 11 * HOUR)
  })

  it('expiring_soon (< 4 h) badge state and < 50 % TTL renewal threshold', () => {
    const record = makeRecord()

    // 13 hours left (> 50% of 24h TTL): valid, shouldRenew = false
    const at11h = evaluateLeaseClock(record, {
      wallNow: T0 + 11 * HOUR,
      monotonicNow: 1_000 + 11 * HOUR,
      sameProcess: true,
    })
    expect(at11h.state).toBe('valid')
    expect(at11h.shouldRenew).toBe(false)

    // 11h 59m left (< 50% of 24h TTL): valid, shouldRenew = true
    const under50Pct = evaluateLeaseClock(record, {
      wallNow: T0 + 12 * HOUR + MIN,
      monotonicNow: 1_000 + 12 * HOUR + MIN,
      sameProcess: true,
    })
    expect(under50Pct.state).toBe('valid')
    expect(under50Pct.shouldRenew).toBe(true)

    // Exactly 4h left: still valid (< 4h triggers expiring_soon)
    const at4h = evaluateLeaseClock(record, {
      wallNow: T0 + 20 * HOUR,
      monotonicNow: 1_000 + 20 * HOUR,
      sameProcess: true,
    })
    expect(at4h.state).toBe('valid')
    expect(at4h.shouldRenew).toBe(true)

    // < 4h left (3h 59m): expiring_soon, shouldRenew = true
    const under4h = evaluateLeaseClock(record, {
      wallNow: T0 + 20 * HOUR + MIN,
      monotonicNow: 1_000 + 20 * HOUR + MIN,
      sameProcess: true,
    })
    expect(under4h.state).toBe('expiring_soon')
    expect(under4h.remainingMs).toBe(4 * HOUR - MIN)
    expect(under4h.shouldRenew).toBe(true)
  })
})
