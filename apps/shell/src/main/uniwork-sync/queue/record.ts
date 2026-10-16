import { isDecimalString } from '../../uniwork-docs/formats'
import type { UniworkDocErrorCode } from '../../../shared/home-api'

/**
 * The durable save-queue record, version 2. The G5-04 record
 * (`PendingIntentRecord`) only carried identity, key, revision, checksum and
 * creation time; the queue adds the account binding (org, workspace, base
 * version), the snapshot length, the state machine and its counters, so one
 * record is enough to resume an intent after a restart.
 *
 * A v1 record still on disk is readable: `readIntentRecord` upgrades it with
 * the binding facts the caller has (org, workspace, base version, length), sets
 * `state: 'queued'`, `attempt: 0`, `generation: 1` and keeps its `createdAt`.
 * The upgrade is one-way - the next write stores v2.
 */

export const QUEUE_STATES = [
  'queued',
  'paused_offline',
  'paused_user',
  'paused_admin',
  'validating',
  'uploading',
  'committing',
  'reconciling',
  'reconciling-stuck',
  'committed',
  'conflict',
  'blocked',
  'failed',
  'cancelled',
] as const

export type QueueState = (typeof QUEUE_STATES)[number]

export function isQueueState(value: unknown): value is QueueState {
  return typeof value === 'string' && (QUEUE_STATES as readonly string[]).includes(value)
}

/** states an intent never leaves on its own */
export function isTerminalQueueState(state: QueueState): boolean {
  return state === 'committed' || state === 'cancelled'
}

/** the commit answer of the server, kept on the record once it is known */
export interface IntentReceipt {
  versionId: string
  version: number
  /** decimal string */
  revision: string
}

export interface IntentRecordV2 {
  v: 2
  intentId: string
  idempotencyKey: string
  documentId: string
  /** the account binding an intent belongs to; '' on a v1 record written without facts */
  orgId: string
  /** '' on a v1 record written without facts */
  workspaceId: string
  /** decimal string */
  baseRevision: string
  baseVersion: number
  /** sha256 hex of the payload bytes */
  checksum: string
  length: number
  /** snapshot generation this intent must clean up; 1 for a fresh intent */
  generation: number
  state: QueueState
  /** server-side attempt count; a new attempt is minted only when the old one is proven not committed */
  attempt: number
  createdAt: string
  updatedAt: string
  /** when the intent may retry (backoff, Retry-After); also the next recheck of a stuck intent */
  retryAt?: string
  /** when the intent entered `reconciling` (the stuck clock runs from here) */
  reconcileSince?: string
  receipt?: IntentReceipt
  lastError?: UniworkDocErrorCode
  /** Server/configured maximum document size in bytes when `lastError === 'too_large'`. */
  maxBytes?: number
  /** why the intent ended in `cancelled` */
  cancelReason?: 'user' | 'superseded'
}

/** what a caller knows about a legacy record's binding, used to upgrade v1 -> v2 */
export interface IntentBindFacts {
  orgId: string
  workspaceId: string
  baseVersion: number
  length: number
}

/** one stored intent: the record plus the exact bytes it uploads */
export interface IntentRecordValue {
  intent: IntentRecordV2
  payload: Uint8Array
}

/** the G5-04 record, kept readable (and writable by G5-04 callers) for the upgrade */
export interface PendingIntentRecord {
  intentId: string
  idempotencyKey: string
  documentId: string
  /** decimal string */
  baseRevision: string
  /** sha256 hex of the payload bytes */
  checksum: string
  createdAt: string
}

const isStr = (value: unknown): value is string => typeof value === 'string' && value.length > 0
/** orgId/workspaceId may be '' when a v1 record was written without binding facts */
const isStrOrEmpty = (value: unknown): value is string => typeof value === 'string'
const isCount = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min

/** the shape check of the G5-04 record (migration and legacy callers use it) */
export function parsePendingIntentRecord(raw: unknown): PendingIntentRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!isStr(r.intentId) || !isStr(r.idempotencyKey) || !isStr(r.documentId)) return null
  if (!isDecimalString(r.baseRevision)) return null
  if (!isStr(r.checksum) || !isStr(r.createdAt)) return null
  return {
    intentId: r.intentId,
    idempotencyKey: r.idempotencyKey,
    documentId: r.documentId,
    baseRevision: r.baseRevision,
    checksum: r.checksum,
    createdAt: r.createdAt,
  }
}

/** the v1 record as a v2 one, bound to the facts its folder carries */
export function upgradePendingIntent(
  legacy: PendingIntentRecord,
  facts: IntentBindFacts,
): IntentRecordV2 {
  return {
    v: 2,
    intentId: legacy.intentId,
    idempotencyKey: legacy.idempotencyKey,
    documentId: legacy.documentId,
    orgId: facts.orgId,
    workspaceId: facts.workspaceId,
    baseRevision: legacy.baseRevision,
    baseVersion: facts.baseVersion,
    checksum: legacy.checksum,
    length: facts.length,
    generation: 1,
    state: 'queued',
    attempt: 0,
    createdAt: legacy.createdAt,
    updatedAt: legacy.createdAt,
  }
}

function readReceipt(raw: unknown): IntentReceipt | null | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!isStr(r.versionId) || !isCount(r.version, 0) || !isDecimalString(r.revision)) return null
  return { versionId: r.versionId, version: r.version, revision: r.revision }
}

function readV2(r: Record<string, unknown>): IntentRecordV2 | null {
  if (!isStr(r.intentId) || !isStr(r.idempotencyKey) || !isStr(r.documentId)) return null
  if (!isStrOrEmpty(r.orgId) || !isStrOrEmpty(r.workspaceId)) return null
  if (!isDecimalString(r.baseRevision)) return null
  if (!isCount(r.baseVersion, 0) || !isCount(r.length, 0)) return null
  if (!isCount(r.generation, 1) || !isCount(r.attempt, 0)) return null
  if (!isStr(r.checksum) || !isStr(r.createdAt) || !isStr(r.updatedAt)) return null
  if (!isQueueState(r.state)) return null
  if (r.retryAt !== undefined && !isStr(r.retryAt)) return null
  if (r.reconcileSince !== undefined && !isStr(r.reconcileSince)) return null
  const receipt = readReceipt(r.receipt)
  if (receipt === null) return null
  if (r.lastError !== undefined && !isStr(r.lastError)) return null
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
    ...(r.retryAt === undefined ? {} : { retryAt: r.retryAt }),
    ...(r.reconcileSince === undefined ? {} : { reconcileSince: r.reconcileSince }),
    ...(receipt === undefined ? {} : { receipt }),
    ...(r.lastError === undefined ? {} : { lastError: r.lastError as UniworkDocErrorCode }),
    ...(isCount(r.maxBytes, 1) ? { maxBytes: r.maxBytes } : {}),
    ...(r.cancelReason === undefined ? {} : { cancelReason: r.cancelReason }),
  }
}

/**
 * The record as it is stored: v2 verbatim, v1 verbatim, anything from a newer
 * queue (or malformed) null. `get` serves this view.
 */
export function parseStoredIntent(raw: unknown): IntentRecordV2 | PendingIntentRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.v === 2) return readV2(r)
  if (r.v === undefined || r.v === 1) return parsePendingIntentRecord(raw)
  // a record from a newer queue: this build does not read it
  return null
}

/** whether a stored record is the v2 one */
export function isIntentRecordV2(
  value: IntentRecordV2 | PendingIntentRecord,
): value is IntentRecordV2 {
  return (value as { v?: unknown }).v === 2
}

/**
 * The generation a NEW intent for a document carries. `stored` is the record
 * exactly as the store holds it: a v2 record (superseded, committed, or just
 * older) means a newer snapshot exists, so the next intent is one past its
 * generation. A v1 record's upgrade never saw a newer snapshot (it stays 1),
 * and neither has an empty store.
 */
export function nextIntentGeneration(stored: IntentRecordV2 | PendingIntentRecord | null): number {
  if (!stored || !isIntentRecordV2(stored)) return 1
  return stored.generation + 1
}

/**
 * The record as a v2 one, or null when it is malformed. A v2 record is read as
 * it is; a v1 record is upgraded with `facts`.
 */
export function readIntentRecord(raw: unknown, facts: IntentBindFacts): IntentRecordV2 | null {
  const stored = parseStoredIntent(raw)
  if (!stored) return null
  return isIntentRecordV2(stored) ? stored : upgradePendingIntent(stored, facts)
}
