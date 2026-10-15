import { describe, expect, it } from 'vitest'
import {
  nextRetryAt,
  transition,
  type NewIntentInput,
  type QueueContext,
  type QueueEvent,
} from '../src/main/uniwork-sync/queue/machine'
import { QUEUE_LIMITS } from '../src/main/uniwork-sync/queue/limits'
import {
  QUEUE_STATES,
  type IntentRecordV2,
  type QueueState,
} from '../src/main/uniwork-sync/queue/record'

/**
 * The G5-06 queue machine, one case per rule of the stage spec (EXPERIENCE ›
 * State Patterns + the G5-06 card). Deterministic: a fake clock and a fake
 * random source, so every timestamp and backoff is exact.
 */

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0)
const iso = (ms: number): string => new Date(ms).toISOString()

const ctx = (overrides: Partial<QueueContext> = {}): QueueContext => ({
  now: NOW,
  random: () => 0.5,
  ...overrides,
})

const newIntent = (overrides: Partial<NewIntentInput> = {}): NewIntentInput => ({
  intentId: 'intent_new',
  idempotencyKey: 'idem_new',
  documentId: 'doc_1',
  orgId: 'org_1',
  workspaceId: 'ws_1',
  baseRevision: '9007199254740993',
  baseVersion: 7,
  checksum: 'b'.repeat(64),
  length: 12,
  ...overrides,
})

const record = (overrides: Partial<IntentRecordV2> = {}): IntentRecordV2 => ({
  v: 2,
  intentId: 'intent_1',
  idempotencyKey: 'idem_1',
  documentId: 'doc_1',
  orgId: 'org_1',
  workspaceId: 'ws_1',
  baseRevision: '9007199254740993',
  baseVersion: 7,
  checksum: 'a'.repeat(64),
  length: 12,
  generation: 1,
  state: 'queued',
  attempt: 0,
  createdAt: '2026-10-13T11:59:00.000Z',
  updatedAt: '2026-10-13T11:59:00.000Z',
  ...overrides,
})

const receipt = { versionId: 'version_1', version: 8, revision: '9007199254740994' }

describe('uniwork save queue machine', () => {
  it('save while an intent exists → no new intent, effect pendingNext (N+1 stays dirty)', () => {
    const stored = record({ state: 'validating' })
    for (const state of [
      'queued',
      'validating',
      'uploading',
      'committing',
      'reconciling',
    ] as const) {
      const out = transition(record({ state }), { type: 'save', intent: newIntent() }, ctx())
      expect(out.record).toEqual(record({ state }))
      expect(out.effects).toEqual([{ kind: 'pendingNext' }])
    }
    expect(stored.intentId).toBe('intent_1')
  })

  it('save with no intent stores the snapshot, parked by the offline/capability/pause facts', () => {
    expect(transition(null, { type: 'save', intent: newIntent() }, ctx()).record).toEqual(
      record({
        intentId: 'intent_new',
        idempotencyKey: 'idem_new',
        checksum: 'b'.repeat(64),
        state: 'queued',
        createdAt: iso(NOW),
        updatedAt: iso(NOW),
      }),
    )
    expect(
      transition(null, { type: 'save', intent: newIntent() }, ctx({ pausedUser: true })).record
        ?.state,
    ).toBe('paused_user')
    expect(
      transition(null, { type: 'save', intent: newIntent() }, ctx({ syncWrite: false })).record
        ?.state,
    ).toBe('paused_admin')
    expect(transition(null, { type: 'save' }, ctx())).toEqual({ record: null, effects: [] })
  })

  it('dispatch picks a queued intent up as validating, and the phase reports walk it to committing', () => {
    expect(transition(record(), { type: 'dispatch' }, ctx()).record?.state).toBe('validating')
    expect(
      transition(record({ state: 'validating' }), { type: 'uploaded' }, ctx()).record?.state,
    ).toBe('uploading')
    expect(
      transition(record({ state: 'uploading' }), { type: 'uploaded' }, ctx()).record?.state,
    ).toBe('committing')
    // only a queued intent is picked up
    expect(
      transition(record({ state: 'paused_user' }), { type: 'dispatch' }, ctx()).record?.state,
    ).toBe('paused_user')
  })

  it('409 base conflict → conflict with the SAME intent', () => {
    const stored = record({ state: 'committing' })
    const out = transition(stored, { type: 'commitFailed', error: 'conflict' }, ctx())
    expect(out.record?.state).toBe('conflict')
    expect(out.record?.intentId).toBe(stored.intentId)
    expect(out.record?.idempotencyKey).toBe(stored.idempotencyKey)
    expect(out.record?.lastError).toBe('conflict')
    expect(out.effects).toEqual([])
  })

  it('lookup committed → committed (receipt kept) + effect cleanup(generation)', () => {
    const out = transition(
      record({ state: 'reconciling', generation: 3, reconcileSince: iso(NOW - 1_000) }),
      { type: 'lookup', outcome: 'committed', receipt },
      ctx(),
    )
    expect(out.record?.state).toBe('committed')
    expect(out.record?.receipt).toEqual(receipt)
    expect(out.record?.generation).toBe(3)
    expect(out.record?.reconcileSince).toBeUndefined()
    expect(out.effects).toEqual([{ kind: 'cleanup', generation: 3 }])
  })

  it('a committed event keeps the receipt and cleans up the generation', () => {
    const out = transition(record({ state: 'committing' }), { type: 'committed', receipt }, ctx())
    expect(out.record?.state).toBe('committed')
    expect(out.effects).toEqual([{ kind: 'cleanup', generation: 1 }])
  })

  it('lookup not_committed → queued with attempt+1', () => {
    const out = transition(
      record({ state: 'reconciling', attempt: 2, reconcileSince: iso(NOW - 1_000) }),
      { type: 'lookup', outcome: 'not_committed' },
      ctx(),
    )
    expect(out.record?.state).toBe('queued')
    expect(out.record?.attempt).toBe(3)
    expect(out.record?.reconcileSince).toBeUndefined()
    expect(out.record?.retryAt).toBeUndefined()
    expect(out.effects).toEqual([])
  })

  it('lookup not_committed with sync_write off → paused_admin, and offline → paused_offline', () => {
    const stored = record({ state: 'reconciling', attempt: 1, reconcileSince: iso(NOW) })
    const paused = transition(
      stored,
      { type: 'lookup', outcome: 'not_committed' },
      ctx({ syncWrite: false }),
    )
    expect(paused.record?.state).toBe('paused_admin')
    expect(paused.record?.attempt).toBe(2)
    const offline = transition(
      stored,
      { type: 'lookup', outcome: 'not_committed' },
      ctx({ online: false }),
    )
    expect(offline.record?.state).toBe('paused_offline')
    expect(offline.record?.attempt).toBe(2)
  })

  it('lookup unknown → reconciling-stuck (never queued)', () => {
    const out = transition(
      record({ state: 'reconciling', attempt: 3, reconcileSince: iso(NOW - 1_000) }),
      { type: 'lookup', outcome: 'unknown' },
      ctx(),
    )
    expect(out.record?.state).toBe('reconciling-stuck')
    expect(out.record?.attempt).toBe(3)
    expect(out.record?.retryAt).toBe(iso(NOW + QUEUE_LIMITS.recheckMs))
    expect(out.effects).toEqual([])
  })

  it('lookup in_flight keeps reconciling and backs off the next lookup', () => {
    const out = transition(
      record({ state: 'reconciling', reconcileSince: iso(NOW - 60_000) }),
      { type: 'lookup', outcome: 'in_flight' },
      ctx({ random: () => 0 }),
    )
    expect(out.record?.state).toBe('reconciling')
    expect(out.record?.reconcileSince).toBe(iso(NOW - 60_000))
    expect(out.record?.retryAt).toBe(iso(NOW + QUEUE_LIMITS.backoffBaseMs / 2))
  })

  it('reconciling older than stuckAfterMs → stuck', () => {
    const since = NOW - QUEUE_LIMITS.stuckAfterMs
    const out = transition(
      record({ state: 'reconciling', attempt: 1, reconcileSince: iso(since) }),
      { type: 'tick', now: NOW },
      ctx(),
    )
    expect(out.record?.state).toBe('reconciling-stuck')
    expect(out.record?.retryAt).toBe(iso(NOW + QUEUE_LIMITS.recheckMs))
    // just under the limit stays reconciling
    const young = transition(
      record({ state: 'reconciling', reconcileSince: iso(NOW - 1_000) }),
      { type: 'tick', now: NOW },
      ctx(),
    )
    expect(young.record?.state).toBe('reconciling')
  })

  it('a stuck tick every recheckMs → effect lookup only, never a new attempt', () => {
    const due = transition(
      record({ state: 'reconciling-stuck', attempt: 2, retryAt: iso(NOW - 1) }),
      { type: 'tick', now: NOW },
      ctx(),
    )
    expect(due.effects).toEqual([{ kind: 'lookup' }])
    expect(due.record?.state).toBe('reconciling-stuck')
    expect(due.record?.attempt).toBe(2)
    expect(due.record?.retryAt).toBe(iso(NOW + QUEUE_LIMITS.recheckMs))
    const early = transition(
      record({ state: 'reconciling-stuck', retryAt: iso(NOW + QUEUE_LIMITS.recheckMs) }),
      { type: 'tick', now: NOW },
      ctx(),
    )
    expect(early.effects).toEqual([])
  })

  it('capability(false) → paused_admin from every non-terminal, non-reconciling waiting state', () => {
    for (const state of [
      'queued',
      'paused_offline',
      'paused_user',
      'validating',
      'uploading',
    ] as const) {
      const out = transition(record({ state }), { type: 'capability', syncWrite: false }, ctx())
      expect(out.record?.state).toBe('paused_admin')
    }
    // committing runs to its receipt, reconciling keeps reconciling, and the
    // user-settled states are never moved by a capability flip
    for (const state of [
      'committing',
      'reconciling',
      'reconciling-stuck',
      'conflict',
      'blocked',
      'failed',
      'committed',
      'cancelled',
    ] as const) {
      const out = transition(record({ state }), { type: 'capability', syncWrite: false }, ctx())
      expect(out.record?.state).toBe(state)
    }
  })

  it('capability(true) resumes a paused_admin as queued (paused_user if the user is paused)', () => {
    expect(
      transition(record({ state: 'paused_admin' }), { type: 'capability', syncWrite: true }, ctx())
        .record?.state,
    ).toBe('queued')
    expect(
      transition(
        record({ state: 'paused_admin' }),
        { type: 'capability', syncWrite: true },
        ctx({ pausedUser: true }),
      ).record?.state,
    ).toBe('paused_user')
  })

  it('offline + Ctrl/⌘+S with the capability past TTL → paused_offline, not paused_admin', () => {
    const out = transition(
      null,
      { type: 'save', intent: newIntent() },
      ctx({ online: false, syncWrite: false }),
    )
    expect(out.record?.state).toBe('paused_offline')
  })

  it('pause → paused_user (durable); resume → queued; paused_user + coming online stays paused_user', () => {
    expect(transition(record(), { type: 'pause' }, ctx()).record?.state).toBe('paused_user')
    expect(
      transition(record({ state: 'paused_offline' }), { type: 'pause' }, ctx()).record?.state,
    ).toBe('paused_user')
    expect(
      transition(record({ state: 'paused_user' }), { type: 'resume' }, ctx()).record?.state,
    ).toBe('queued')
    expect(
      transition(record({ state: 'paused_user' }), { type: 'online', online: true }, ctx()).record
        ?.state,
    ).toBe('paused_user')
    // coming online wakes a paused_offline; a user pause then lands on paused_user
    expect(
      transition(record({ state: 'paused_offline' }), { type: 'online', online: true }, ctx())
        .record?.state,
    ).toBe('queued')
    expect(
      transition(
        record({ state: 'paused_offline' }),
        { type: 'online', online: true },
        ctx({ pausedUser: true }),
      ).record?.state,
    ).toBe('paused_user')
  })

  it('cancel allowed only from queued / paused_* / failed / conflict → cancelled (cancelReason user) + effect keepDraft', () => {
    for (const state of [
      'queued',
      'paused_offline',
      'paused_user',
      'paused_admin',
      'failed',
      'conflict',
    ] as const) {
      const out = transition(record({ state }), { type: 'cancel' }, ctx())
      expect(out.record?.state).toBe('cancelled')
      expect(out.record?.cancelReason).toBe('user')
      expect(out.effects).toEqual([{ kind: 'keepDraft' }])
    }
    for (const state of [
      'validating',
      'uploading',
      'committing',
      'reconciling',
      'reconciling-stuck',
      'blocked',
      'committed',
      'cancelled',
    ] as const) {
      const out = transition(record({ state }), { type: 'cancel' }, ctx())
      expect(out.record?.state).toBe(state)
      expect(out.effects).toEqual([])
    }
  })

  it('discard on stuck → effect keepDraft then cancelled, refused anywhere else', () => {
    const out = transition(
      record({ state: 'reconciling-stuck', reconcileSince: iso(NOW - 1_000) }),
      { type: 'discard' },
      ctx(),
    )
    expect(out.record?.state).toBe('cancelled')
    expect(out.record?.cancelReason).toBe('user')
    expect(out.effects).toEqual([{ kind: 'keepDraft' }])
    const refused = transition(record({ state: 'queued' }), { type: 'discard' }, ctx())
    expect(refused.record?.state).toBe('queued')
    expect(refused.effects).toEqual([])
  })

  it('supersede (Overwrite/Reload, or "Lưu lại" on failed) → cancelled (cancelReason superseded) BEFORE any new intent', () => {
    for (const state of ['conflict', 'failed', 'queued', 'paused_user'] as const) {
      const out = transition(record({ state }), { type: 'supersede' }, ctx())
      expect(out.record?.state).toBe('cancelled')
      expect(out.record?.cancelReason).toBe('superseded')
      expect(out.effects).toEqual([])
    }
    // never a committing/reconciling/stuck intent (Reload/Ghi đè waits)
    for (const state of ['committing', 'reconciling', 'reconciling-stuck', 'uploading'] as const) {
      const out = transition(record({ state }), { type: 'supersede' }, ctx())
      expect(out.record?.state).toBe(state)
    }
  })

  it('abandon ("Bỏ nháp…" on a blocked row) → cancelled (cancelReason user), no draft effect; refused from every other state', () => {
    for (const lastError of [
      'permission_revoked',
      'document_deleted',
      'member_deactivated',
      'organization_suspended',
      'session_expired',
    ] as const) {
      const out = transition(record({ state: 'blocked', lastError }), { type: 'abandon' }, ctx())
      expect(out.record?.state, lastError).toBe('cancelled')
      expect(out.record?.cancelReason, lastError).toBe('user')
      expect(out.record?.intentId, lastError).toBe('intent_1')
      expect(out.effects, lastError).toEqual([])
    }
    for (const state of QUEUE_STATES) {
      if (state === 'blocked') continue
      const before = record({ state })
      const out = transition(before, { type: 'abandon' }, ctx())
      expect(out.record, state).toEqual(before)
      expect(out.effects, state).toEqual([])
    }
  })

  it('tombstone / document_deleted → blocked, replay stops', () => {
    const out = transition(record({ state: 'queued' }), { type: 'tombstone' }, ctx())
    expect(out.record?.state).toBe('blocked')
    expect(out.record?.lastError).toBe('document_deleted')
    const deleted = transition(
      record({ state: 'uploading' }),
      { type: 'commitFailed', error: 'document_deleted' },
      ctx(),
    )
    expect(deleted.record?.state).toBe('blocked')
    expect(deleted.record?.lastError).toBe('document_deleted')
    // a settled intent is not moved by a tombstone
    expect(
      transition(record({ state: 'committed' }), { type: 'tombstone' }, ctx()).record?.state,
    ).toBe('committed')
  })

  it('401 → blocked(session_expired); 403 by code → blocked with that code; other 403 → blocked(permission_revoked)', () => {
    const cases: Array<[QueueEvent, QueueState]> = [
      [{ type: 'commitFailed', error: 'session_expired' }, 'session_expired'],
      [{ type: 'lookup', error: 'session_expired' }, 'session_expired'],
      [{ type: 'commitFailed', error: 'member_deactivated' }, 'member_deactivated'],
      [{ type: 'commitFailed', error: 'organization_suspended' }, 'organization_suspended'],
      [{ type: 'commitFailed', error: 'forbidden' }, 'permission_revoked'],
      [{ type: 'commitFailed', error: 'not_found' }, 'permission_revoked'],
    ] as Array<[QueueEvent, QueueState]>
    for (const [event, reason] of cases) {
      const out = transition(record({ state: 'reconciling' }), event, ctx())
      expect(out.record?.state).toBe('blocked')
      expect(out.record?.lastError).toBe(reason)
    }
  })

  it('capability_off → paused_admin (never blocked)', () => {
    for (const state of ['queued', 'uploading', 'reconciling'] as const) {
      const out = transition(
        record({ state }),
        { type: 'commitFailed', error: 'capability_off' },
        ctx(),
      )
      expect(out.record?.state).toBe('paused_admin')
      expect(out.record?.lastError).toBe('capability_off')
    }
  })

  it('quota → failed (and the other permanent errors too)', () => {
    for (const error of [
      'quota_exceeded',
      'too_large',
      'engine_incompatible',
      'idempotency_mismatch',
    ] as const) {
      const out = transition(record({ state: 'uploading' }), { type: 'commitFailed', error }, ctx())
      expect(out.record?.state).toBe('failed')
      expect(out.record?.lastError).toBe(error)
    }
  })

  it('a lost response after the commit started → reconciling, never failed', () => {
    for (const error of ['network', 'timeout', 'server_error', 'malformed_response'] as const) {
      const out = transition(
        record({ state: 'committing' }),
        { type: 'commitFailed', error },
        ctx({ online: true }),
      )
      expect(out.record?.state).toBe('reconciling')
      expect(out.record?.reconcileSince).toBe(iso(NOW))
    }
    // an expired upload claim is looked up before re-uploading bytes
    const claim = transition(
      record({ state: 'uploading' }),
      { type: 'commitFailed', error: 'ticket_expired' },
      ctx({ online: true }),
    )
    expect(claim.record?.state).toBe('reconciling')
  })

  it('a transient failure before the commit retries queued with backoff, or waits the network offline', () => {
    const retried = transition(
      record({ state: 'uploading' }),
      { type: 'commitFailed', error: 'server_error' },
      ctx({ online: true, random: () => 0 }),
    )
    expect(retried.record?.state).toBe('queued')
    expect(retried.record?.retryAt).toBe(iso(NOW + QUEUE_LIMITS.backoffBaseMs / 2))
    const offline = transition(
      record({ state: 'uploading' }),
      { type: 'commitFailed', error: 'network' },
      ctx({ online: true }),
    )
    expect(offline.record?.state).toBe('paused_offline')
  })

  it('keystore lock while reconciling → stays reconciling', () => {
    const stored = record({ state: 'reconciling', attempt: 1, reconcileSince: iso(NOW - 1_000) })
    const locked = transition(stored, { type: 'lookup', error: 'keystore_locked' }, ctx())
    expect(locked.record?.state).toBe('reconciling')
    expect(locked.record?.attempt).toBe(1)
    expect(locked.effects).toEqual([])
    const storeFull = transition(stored, { type: 'lookup', error: 'store_full' }, ctx())
    expect(storeFull.record?.state).toBe('reconciling')
  })

  it('backoff: nextRetryAt jitters between half and the cap, and never passes backoffMaxMs', () => {
    expect(nextRetryAt(0, () => 0, { now: NOW })).toBe(iso(NOW + QUEUE_LIMITS.backoffBaseMs / 2))
    expect(nextRetryAt(0, () => 1, { now: NOW })).toBe(iso(NOW + QUEUE_LIMITS.backoffBaseMs))
    expect(nextRetryAt(2, () => 1, { now: NOW })).toBe(iso(NOW + 4 * QUEUE_LIMITS.backoffBaseMs))
    expect(nextRetryAt(50, () => 1, { now: NOW })).toBe(iso(NOW + QUEUE_LIMITS.backoffMaxMs))
    expect(nextRetryAt(50, () => 0, { now: NOW })).toBe(iso(NOW + QUEUE_LIMITS.backoffMaxMs / 2))
  })

  it('backoff: Retry-After is honoured but clamped to retryAfterClampMs', () => {
    expect(nextRetryAt(0, () => 0.5, { now: NOW, retryAfterMs: 10_000 })).toBe(iso(NOW + 10_000))
    expect(nextRetryAt(0, () => 0.5, { now: NOW, retryAfterMs: 10_000_000 })).toBe(
      iso(NOW + QUEUE_LIMITS.retryAfterClampMs),
    )
    const out = transition(
      record({ state: 'uploading' }),
      { type: 'commitFailed', error: 'server_error', retryAfterMs: 10_000_000 },
      ctx({ online: true }),
    )
    expect(out.record?.retryAt).toBe(iso(NOW + QUEUE_LIMITS.retryAfterClampMs))
  })

  it('every event with no record is a no-op except save', () => {
    const events: QueueEvent[] = [
      { type: 'dispatch' },
      { type: 'uploaded' },
      { type: 'cancel' },
      { type: 'discard' },
      { type: 'tombstone' },
      { type: 'tick', now: NOW },
    ]
    for (const event of events) {
      expect(transition(null, event, ctx())).toEqual({ record: null, effects: [] })
    }
  })
})
