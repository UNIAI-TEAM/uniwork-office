import { describe, expect, it } from 'vitest'
import {
  isTerminalQueueState,
  parsePendingIntentRecord,
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
})
