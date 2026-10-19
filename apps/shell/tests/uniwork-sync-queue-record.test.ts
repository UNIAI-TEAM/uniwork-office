import { describe, expect, it } from 'vitest'
import { isDecimalString } from '../src/main/uniwork-docs/formats'
import {
  isQueueState,
  isTerminalQueueState,
  nextIntentGeneration,
  parsePendingIntentRecord,
  parseStoredIntent,
  readIntentRecord,
  type IntentBindFacts,
  type IntentRecordV2,
  type PendingIntentRecord,
} from '../src/main/uniwork-sync/queue/record'
import { QUEUE_STATES } from '../src/main/uniwork-sync/queue/record'

/**
 * The v1 -> v2 read path of the queue record: a G5-04 `PendingIntentRecord` on
 * disk reads as a v2 one with the facts the caller's binding carries, and
 * anything malformed reads as null (never a half-record).
 */

const FACTS: IntentBindFacts = {
  orgId: 'org_1',
  workspaceId: 'ws_1',
  baseVersion: 7,
  length: 12,
}

const legacy = (overrides: Partial<PendingIntentRecord> = {}): PendingIntentRecord => ({
  intentId: 'intent_1',
  idempotencyKey: 'idem_1',
  documentId: 'doc_1',
  baseRevision: '9007199254740993',
  checksum: 'a'.repeat(64),
  createdAt: '2026-10-12T00:00:00.000Z',
  ...overrides,
})

const v2 = (overrides: Partial<IntentRecordV2> = {}): IntentRecordV2 => ({
  v: 2,
  ...legacy(),
  orgId: 'org_1',
  workspaceId: 'ws_1',
  baseVersion: 7,
  length: 12,
  generation: 1,
  state: 'queued',
  attempt: 0,
  updatedAt: '2026-10-12T00:00:00.000Z',
  ...overrides,
})

describe('uniwork queue record', () => {
  it('upgrades a v1 record to v2: state queued, attempt 0, generation 1, facts from the binding', () => {
    expect(readIntentRecord(legacy(), FACTS)).toEqual(v2())
  })

  it('keeps the v1 fields and reads the v2 record as it is', () => {
    const stored = v2({
      state: 'reconciling',
      attempt: 2,
      generation: 4,
      retryAt: '2026-10-13T00:00:00.000Z',
      reconcileSince: '2026-10-12T00:00:00.000Z',
      receipt: { versionId: 'version_1', version: 8, revision: '9007199254740994' },
      lastError: 'network',
      cancelReason: 'user',
      orgId: 'org_9',
      length: 99,
    })
    // the facts of a v2 record are never overridden by the caller
    expect(readIntentRecord(stored, FACTS)).toEqual(stored)
  })

  it('reads malformed records as null', () => {
    expect(readIntentRecord(null, FACTS)).toBeNull()
    expect(readIntentRecord('nope', FACTS)).toBeNull()
    expect(readIntentRecord([], FACTS)).toBeNull()
    expect(readIntentRecord({ ...legacy(), idempotencyKey: '' }, FACTS)).toBeNull()
    expect(readIntentRecord({ ...legacy(), baseRevision: '1.5' }, FACTS)).toBeNull()
    expect(readIntentRecord({ ...legacy(), checksum: undefined }, FACTS)).toBeNull()
    // a v2 record with a bad state, a bad receipt or a bad counter
    expect(readIntentRecord({ ...v2(), state: 'sending' }, FACTS)).toBeNull()
    expect(readIntentRecord({ ...v2(), attempt: -1 }, FACTS)).toBeNull()
    expect(readIntentRecord({ ...v2(), generation: 0 }, FACTS)).toBeNull()
    expect(readIntentRecord({ ...v2(), receipt: { versionId: 'v' } }, FACTS)).toBeNull()
    expect(readIntentRecord({ ...v2(), cancelReason: 'gone' }, FACTS)).toBeNull()
    // a record from a newer queue is not this build's to read
    expect(readIntentRecord({ ...v2(), v: 3 }, FACTS)).toBeNull()
  })

  it('accepts a v2 record that carries no org/workspace (a v1 write upgraded without facts)', () => {
    const upgraded = readIntentRecord(legacy(), {
      orgId: '',
      workspaceId: '',
      baseVersion: 0,
      length: 0,
    })
    expect(upgraded?.orgId).toBe('')
    expect(upgraded?.workspaceId).toBe('')
    expect(readIntentRecord(upgraded, FACTS)).toEqual(upgraded)
  })

  it('the next intent generation: one past a v2 record, 1 over a v1 record or nothing', () => {
    expect(nextIntentGeneration(v2())).toBe(2)
    expect(nextIntentGeneration(v2({ generation: 4, state: 'cancelled' }))).toBe(5)
    // a v1 record's upgrade never saw a newer snapshot: the next generation is 1
    expect(nextIntentGeneration(legacy())).toBe(1)
    expect(nextIntentGeneration(null)).toBe(1)
  })

  it('the v1 parser keeps the G5-04 shape check', () => {
    expect(parsePendingIntentRecord(legacy())).toEqual(legacy())
    expect(parsePendingIntentRecord({ ...legacy(), createdAt: '' })).toBeNull()
  })

  it('lists the queue states and marks the terminal ones', () => {
    expect(QUEUE_STATES).toContain('queued')
    expect(QUEUE_STATES).toContain('reconciling-stuck')
    expect(QUEUE_STATES).toHaveLength(14)
    expect(isTerminalQueueState('committed')).toBe(true)
    expect(isTerminalQueueState('cancelled')).toBe(true)
    expect(isTerminalQueueState('blocked')).toBe(false)
    expect(isTerminalQueueState('failed')).toBe(false)
  })

  it('keeps a valid uploadSession on a v2 record, drops a malformed one without rejecting the record, and the v1.0.0-beta.3 parser accepts it', () => {
    const uploadSession = {
      sessionId: 'ups_01ja09k3',
      partSize: 8 * 1024 * 1024,
      totalParts: 6,
      completedParts: [
        { partNumber: 1, etag: '"e1"' },
        { partNumber: 2, etag: '"e2"' },
        { partNumber: 3, etag: '"e3"' },
      ],
      expiresAt: '2099-01-01T00:00:00.000Z',
    }
    const withSession = v2({ state: 'uploading', uploadSession })
    expect(readIntentRecord(withSession, FACTS)).toEqual(withSession)
    expect(parseStoredIntent(withSession)).toEqual(withSession)

    // a malformed uploadSession is dropped rather than rejecting the save record
    const withBadSession = { ...v2(), uploadSession: { sessionId: '', partSize: 0 } }
    expect(readIntentRecord(withBadSession, FACTS)).toEqual(v2())

    // G5-04g store-level check: verbatim copy of v1.0.0-beta.3's (4bdba928d)
    // parseStoredIntent / readV2. It constructs the returned object from known
    // v2 fields and ignores unknown fields (`uploadSession`) without rejecting.
    function parseStoredIntentBeta3(raw: unknown): IntentRecordV2 | PendingIntentRecord | null {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const r = raw as Record<string, unknown>
      if (r.v !== 2) return parsePendingIntentRecord(raw)
      if (
        typeof r.intentId !== 'string' ||
        !r.intentId ||
        typeof r.idempotencyKey !== 'string' ||
        !r.idempotencyKey ||
        typeof r.documentId !== 'string' ||
        !r.documentId
      ) {
        return null
      }
      if (typeof r.orgId !== 'string' || typeof r.workspaceId !== 'string') return null
      if (!isDecimalString(r.baseRevision)) return null
      if (
        typeof r.baseVersion !== 'number' ||
        !Number.isSafeInteger(r.baseVersion) ||
        r.baseVersion < 0 ||
        typeof r.length !== 'number' ||
        !Number.isSafeInteger(r.length) ||
        r.length < 0
      ) {
        return null
      }
      if (
        typeof r.generation !== 'number' ||
        !Number.isSafeInteger(r.generation) ||
        r.generation < 1 ||
        typeof r.attempt !== 'number' ||
        !Number.isSafeInteger(r.attempt) ||
        r.attempt < 0
      ) {
        return null
      }
      if (
        typeof r.checksum !== 'string' ||
        !r.checksum ||
        typeof r.createdAt !== 'string' ||
        !r.createdAt ||
        typeof r.updatedAt !== 'string' ||
        !r.updatedAt
      ) {
        return null
      }
      if (!isQueueState(r.state)) return null
      if (r.retryAt !== undefined && (typeof r.retryAt !== 'string' || !r.retryAt)) return null
      if (
        r.reconcileSince !== undefined &&
        (typeof r.reconcileSince !== 'string' || !r.reconcileSince)
      ) {
        return null
      }
      if (r.lastError !== undefined && (typeof r.lastError !== 'string' || !r.lastError)) {
        return null
      }
      if (
        r.cancelReason !== undefined &&
        r.cancelReason !== 'user' &&
        r.cancelReason !== 'superseded'
      ) {
        return null
      }
      return {
        v: 2,
        intentId: r.intentId,
        idempotencyKey: r.idempotencyKey,
        documentId: r.documentId,
        orgId: r.orgId,
        workspaceId: r.workspaceId,
        baseRevision: r.baseRevision,
        baseVersion: r.baseVersion,
        checksum: r.checksum,
        length: r.length,
        generation: r.generation,
        state: r.state,
        attempt: r.attempt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }
    }

    const beta3Parsed = parseStoredIntentBeta3(withSession)
    expect(beta3Parsed).toEqual(v2({ state: 'uploading' }))
    expect(parsePendingIntentRecord(withSession)).toEqual({
      intentId: withSession.intentId,
      idempotencyKey: withSession.idempotencyKey,
      documentId: withSession.documentId,
      baseRevision: withSession.baseRevision,
      checksum: withSession.checksum,
      createdAt: withSession.createdAt,
    })
  })
})
