import type { UniworkDocErrorCode } from '../../../shared/home-api'
import { QUEUE_LIMITS, type QueueLimits } from './limits'
import {
  isTerminalQueueState,
  type IntentReceipt,
  type IntentRecordV2,
  type QueueState,
} from './record'

/**
 * The pure state machine of one save intent. Everything the queue does to a
 * record is a `transition` over an event, so the whole EXPERIENCE â€º State
 * Patterns behaviour (Ctrl/âŒ˜+S table, Queue rows, blocked reasons, capability
 * off) is one table with no I/O: the dispatcher (W4) performs the effects and
 * persists the returned record.
 *
 * Event vocabulary (fixed by the G5-06 contract): `save | dispatch | uploaded |
 * committed | commitFailed | lookup | pause | resume | capability | online |
 * cancel | discard | supersede | tombstone | tick`; G5-11f adds `unblock`, the
 * one way a `blocked` intent returns to the queue when its condition lifts (a
 * block is never retried on its own, and `abandon` stays the user's way out).
 * The contract gives no separate event for each in-flight step, so `uploaded`
 * advances the phase boundary it reports: validating -> uploading, then
 * uploading -> committing.
 *
 * Terminal states are `committed` and `cancelled`; `blocked`, `failed` and
 * `conflict` wait for the user (or the server) and are never moved by a
 * capability flip - only waiting/in-flight states park as `paused_admin`.
 */

export interface NewIntentInput {
  intentId: string
  idempotencyKey: string
  documentId: string
  orgId: string
  workspaceId: string
  /** decimal string */
  baseRevision: string
  baseVersion: number
  /** sha256 hex of the payload bytes */
  checksum: string
  length: number
  /** defaults to `ctx.now` */
  createdAt?: string
}

export type QueueEffect =
  | { kind: 'pendingNext' }
  | { kind: 'cleanup'; generation: number }
  | { kind: 'lookup' }
  | { kind: 'keepDraft' }

export type QueueEvent =
  | { type: 'save'; intent?: NewIntentInput }
  | { type: 'dispatch' }
  | { type: 'uploaded' }
  | { type: 'committed'; receipt: IntentReceipt }
  | { type: 'commitFailed'; error: UniworkDocErrorCode; retryAfterMs?: number; maxBytes?: number }
  | (
      | { type: 'lookup'; outcome: 'committed'; receipt: IntentReceipt }
      | { type: 'lookup'; outcome: 'not_committed' }
      | { type: 'lookup'; outcome: 'in_flight'; retryAfterMs?: number }
      | { type: 'lookup'; outcome: 'unknown' }
      | { type: 'lookup'; error: UniworkDocErrorCode; retryAfterMs?: number; maxBytes?: number }
    )
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'capability'; syncWrite: boolean }
  | { type: 'online'; online: boolean }
  | { type: 'cancel' }
  | { type: 'discard' }
  | { type: 'supersede' }
  | { type: 'abandon' }
  | { type: 'unblock'; reason: BlockedReason }
  | { type: 'tombstone' }
  | { type: 'tick'; now: number }

export interface QueueContext {
  /** epoch ms of this transition */
  now: number
  limits?: QueueLimits
  /** false parks a new or failed attempt as `paused_offline` */
  online?: boolean
  /** the org capability's `sync_write`; undefined = never read (writes allowed) */
  syncWrite?: boolean
  /** the account's durable "pause sending" flag */
  pausedUser?: boolean
  /** jitter source of the backoff; tests inject a fake */
  random?: () => number
}

export interface TransitionResult {
  record: IntentRecordV2 | null
  effects: QueueEffect[]
}

export interface NextRetryOptions {
  now: number
  /** a `Retry-After` the server sent, honoured up to `retryAfterClampMs` */
  retryAfterMs?: number
  limits?: Pick<QueueLimits, 'backoffBaseMs' | 'backoffMaxMs' | 'retryAfterClampMs'>
}

/**
 * When the same intent may be attempted again: exponential backoff with jitter
 * from `attempt`, or a server `Retry-After` clamped to `retryAfterClampMs`.
 */
export function nextRetryAt(
  attempt: number,
  random: () => number,
  options: NextRetryOptions,
): string {
  const limits = options.limits ?? QUEUE_LIMITS
  let delay: number
  if (typeof options.retryAfterMs === 'number' && Number.isFinite(options.retryAfterMs)) {
    delay = Math.min(Math.max(Math.round(options.retryAfterMs), 0), limits.retryAfterClampMs)
  } else {
    const steps = Math.max(0, Math.min(Math.floor(attempt), 30))
    const cap = Math.min(limits.backoffBaseMs * 2 ** steps, limits.backoffMaxMs)
    const jitter = Math.min(Math.max(random(), 0), 1)
    delay = Math.round(cap * (0.5 + 0.5 * jitter))
  }
  return new Date(options.now + delay).toISOString()
}

const iso = (now: number): string => new Date(now).toISOString()

/**
 * The conditions a commit failure can park an intent on, one per EXPERIENCE ›
 * "Lý do bị chặn" row the queue can produce. Each has its own lift (`unblock`),
 * so a session that comes back never wakes an intent the document itself kept
 * blocked, and the other way round.
 */
export type BlockedReason =
  | 'session_expired'
  | 'permission_revoked'
  | 'member_deactivated'
  | 'organization_suspended'
  | 'document_deleted'
  | 'document_archived'

/** the reason a commit failure parks the intent, by server/client code */
const BLOCKED_REASONS: Record<string, BlockedReason> = {
  session_expired: 'session_expired',
  not_signed_in: 'session_expired',
  wrong_deployment: 'session_expired',
  forbidden: 'permission_revoked',
  permission_revoked: 'permission_revoked',
  member_deactivated: 'member_deactivated',
  organization_suspended: 'organization_suspended',
  document_deleted: 'document_deleted',
  deleted: 'document_deleted',
  // an archived document is not a deleted one: the write is refused while it
  // sits in the archive, and putting it back is its own lift
  document_archived: 'document_archived',
  // a 404 with the UniWork envelope is access this account no longer has
  not_found: 'permission_revoked',
}

/** permanent failures: the intent is kept, but nothing retries on its own */
const FAILED_CODES = new Set<UniworkDocErrorCode>([
  'quota_exceeded',
  'too_large',
  'unsupported_format',
  'engine_incompatible',
  'idempotency_mismatch',
])

/** states a capability off parks as `paused_admin` (waiting or in flight) */
const CAPABILITY_PAUSABLE = new Set<QueueState>([
  'queued',
  'paused_offline',
  'paused_user',
  'validating',
  'uploading',
])

/** cancel knows the commit did not happen: still queued or waiting on the user */
export const CANCELLABLE: ReadonlySet<QueueState> = new Set<QueueState>([
  'queued',
  'paused_offline',
  'paused_user',
  'paused_admin',
  'failed',
  'conflict',
])

/** Overwrite/Reload/"LÆ°u láº¡i" replace the intent; in-flight or stuck ones are never superseded */
const SUPERSEDABLE = new Set<QueueState>([
  'queued',
  'paused_offline',
  'paused_user',
  'paused_admin',
  'failed',
  'conflict',
])

const OPTIONAL_KEYS = [
  'retryAt',
  'reconcileSince',
  'receipt',
  'lastError',
  'maxBytes',
  'cancelReason',
  'uploadSession',
] as const

function withState(
  record: IntentRecordV2,
  ctx: QueueContext,
  state: QueueState,
  patch: Partial<IntentRecordV2> = {},
): IntentRecordV2 {
  const merged: IntentRecordV2 = { ...record, ...patch, state, updatedAt: iso(ctx.now) }
  for (const key of OPTIONAL_KEYS) {
    if (merged[key] === undefined) delete merged[key]
  }
  return merged
}

function limitsOf(ctx: QueueContext): QueueLimits {
  return ctx.limits ?? QUEUE_LIMITS
}

function retryStamp(ctx: QueueContext, attempt: number, retryAfterMs?: number): string {
  return nextRetryAt(attempt, ctx.random ?? Math.random, {
    now: ctx.now,
    limits: limitsOf(ctx),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  })
}

function recheckStamp(ctx: QueueContext): string {
  return iso(ctx.now + limitsOf(ctx).recheckMs)
}

function enterReconciling(record: IntentRecordV2, ctx: QueueContext): IntentRecordV2 {
  return withState(record, ctx, 'reconciling', {
    reconcileSince: record.reconcileSince ?? iso(ctx.now),
    retryAt: undefined,
    lastError: undefined,
    maxBytes: undefined,
  })
}

function enterStuck(record: IntentRecordV2, ctx: QueueContext): IntentRecordV2 {
  return withState(record, ctx, 'reconciling-stuck', {
    reconcileSince: record.reconcileSince ?? iso(ctx.now),
    retryAt: recheckStamp(ctx),
  })
}

/**
 * Where an unblocked intent waits: the queue, unless the user's own pause or a
 * known-offline pass still says otherwise (the same wake a `capability` or
 * `online` flip uses).
 */
function waitingState(ctx: QueueContext): QueueState {
  if (ctx.pausedUser === true) return 'paused_user'
  return ctx.online === false ? 'paused_offline' : 'queued'
}

function createFromSave(
  input: NewIntentInput | undefined,
  ctx: QueueContext,
): IntentRecordV2 | null {
  if (!input) return null
  // offline wins over a known-off capability (Ctrl/âŒ˜+S while the capability is
  // past its TTL and there is no network is `paused_offline`, not `paused_admin`)
  const state: QueueState =
    ctx.online === false
      ? 'paused_offline'
      : ctx.syncWrite === false
        ? 'paused_admin'
        : ctx.pausedUser === true
          ? 'paused_user'
          : 'queued'
  return {
    v: 2,
    intentId: input.intentId,
    idempotencyKey: input.idempotencyKey,
    documentId: input.documentId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    baseRevision: input.baseRevision,
    baseVersion: input.baseVersion,
    checksum: input.checksum,
    length: input.length,
    generation: 1,
    state,
    attempt: 0,
    createdAt: input.createdAt ?? iso(ctx.now),
    updatedAt: iso(ctx.now),
  }
}

function onSave(
  record: IntentRecordV2,
  event: { type: 'save'; intent?: NewIntentInput },
  ctx: QueueContext,
): TransitionResult {
  // a cancelled intent is spent: the next Save starts a fresh one (there is
  // still no second intent while one is live - N+1 only stays dirty)
  if (record.state === 'cancelled') {
    const created = createFromSave(event.intent, ctx)
    return created ? { record: created, effects: [] } : { record: null, effects: [] }
  }
  return { record, effects: [{ kind: 'pendingNext' }] }
}

function onCommitted(
  record: IntentRecordV2,
  receipt: IntentReceipt,
  ctx: QueueContext,
): TransitionResult {
  if (record.state === 'cancelled' || record.state === 'committed') {
    return { record, effects: [] }
  }
  return {
    record: withState(record, ctx, 'committed', {
      receipt,
      retryAt: undefined,
      reconcileSince: undefined,
      lastError: undefined,
      maxBytes: undefined,
      uploadSession: undefined,
    }),
    effects: [{ kind: 'cleanup', generation: record.generation }],
  }
}

function onCommitFailed(
  record: IntentRecordV2,
  event: {
    type: 'commitFailed'
    error: UniworkDocErrorCode
    retryAfterMs?: number
    maxBytes?: number
  },
  ctx: QueueContext,
): TransitionResult {
  // a settled intent has nothing left to fail
  if (isTerminalQueueState(record.state)) return { record, effects: [] }
  const { error } = event
  if (error === 'conflict') {
    // the base moved: durable conflict with the SAME intent, never a retry
    return {
      record: withState(record, ctx, 'conflict', {
        lastError: 'conflict',
        retryAt: undefined,
        reconcileSince: undefined,
        maxBytes: undefined,
      }),
      effects: [],
    }
  }
  if (error === 'capability_off') {
    // never blocked: the admin turned sync_write off
    return {
      record: withState(record, ctx, 'paused_admin', {
        lastError: 'capability_off',
        retryAt: undefined,
        maxBytes: undefined,
      }),
      effects: [],
    }
  }
  const blocked = BLOCKED_REASONS[error]
  if (blocked) {
    return {
      record: withState(record, ctx, 'blocked', {
        lastError: blocked,
        retryAt: undefined,
        reconcileSince: undefined,
        maxBytes: undefined,
      }),
      effects: [],
    }
  }
  if (FAILED_CODES.has(error)) {
    const maxBytes =
      error === 'too_large' &&
      typeof event.maxBytes === 'number' &&
      Number.isSafeInteger(event.maxBytes) &&
      event.maxBytes > 0
        ? event.maxBytes
        : undefined
    return {
      record: withState(record, ctx, 'failed', {
        lastError: error,
        retryAt: undefined,
        reconcileSince: undefined,
        maxBytes,
      }),
      effects: [],
    }
  }
  if (error === 'intent_unknown') {
    // "unknown" is never queued: the outcome cannot be proven either way
    return { record: enterStuck(record, ctx), effects: [] }
  }
  if (error === 'other_window') {
    // another window owns the document lock: read-only, the intent stays
    return { record: withState(record, ctx, 'paused_offline', { retryAt: undefined }), effects: [] }
  }
  if (error === 'ticket_expired') {
    // the upload claim expired: look the intent up before touching bytes again
    return { record: enterReconciling(record, ctx), effects: [] }
  }
  if (error === 'keystore_locked' || error === 'store_full' || error === 'drafts_full') {
    // store-level refusals are not commit outcomes; the record does not move
    return { record, effects: [] }
  }
  // the response may have been lost after the commit request was sent: never
  // call that failed, always reconcile
  if (record.state === 'committing' || record.state === 'reconciling') {
    return { record: enterReconciling(record, ctx), effects: [] }
  }
  if (record.state === 'reconciling-stuck') return { record: record, effects: [] }
  if (ctx.online === false || error === 'network') {
    // unreachable with an intent is `paused_offline` (EXPERIENCE â€º Save pill)
    return {
      record: withState(record, ctx, 'paused_offline', { retryAt: undefined }),
      effects: [],
    }
  }
  return {
    record: withState(record, ctx, 'queued', {
      retryAt: retryStamp(ctx, record.attempt, event.retryAfterMs),
      lastError: error,
    }),
    effects: [],
  }
}

function onLookup(
  record: IntentRecordV2,
  event: Extract<QueueEvent, { type: 'lookup' }>,
  ctx: QueueContext,
): TransitionResult {
  if ('outcome' in event) {
    if (event.outcome === 'committed') return onCommitted(record, event.receipt, ctx)
    // a settled intent is not moved by a lookup verdict
    if (isTerminalQueueState(record.state)) return { record, effects: [] }
    if (event.outcome === 'not_committed') {
      // proven not committed: only here is a new attempt minted
      const state: QueueState =
        ctx.online === false
          ? 'paused_offline'
          : ctx.syncWrite === false
            ? 'paused_admin'
            : 'queued'
      return {
        record: withState(record, ctx, state, {
          attempt: record.attempt + 1,
          retryAt: undefined,
          reconcileSince: undefined,
          lastError: undefined,
        }),
        effects: [],
      }
    }
    if (event.outcome === 'in_flight') {
      return {
        record: withState(record, ctx, 'reconciling', {
          reconcileSince: record.reconcileSince ?? iso(ctx.now),
          retryAt: retryStamp(ctx, record.attempt, event.retryAfterMs),
        }),
        effects: [],
      }
    }
    // `unknown`: never queued, never a new attempt
    return { record: enterStuck(record, ctx), effects: [] }
  }
  const { error } = event
  if (error === 'keystore_locked' || error === 'store_full') {
    // the store locked while reconciling: the state does not change
    return { record, effects: [] }
  }
  if (error === 'intent_unknown') return { record: enterStuck(record, ctx), effects: [] }
  const blocked = BLOCKED_REASONS[error]
  if (blocked) {
    return {
      record: withState(record, ctx, 'blocked', {
        lastError: blocked,
        retryAt: undefined,
        reconcileSince: undefined,
      }),
      effects: [],
    }
  }
  if (FAILED_CODES.has(error)) {
    return {
      record: withState(record, ctx, 'failed', {
        lastError: error,
        retryAt: undefined,
        reconcileSince: undefined,
      }),
      effects: [],
    }
  }
  // transient: look again later, from wherever the record is
  return {
    record: withState(record, ctx, record.state, {
      retryAt: retryStamp(ctx, record.attempt, event.retryAfterMs),
    }),
    effects: [],
  }
}

function onTick(record: IntentRecordV2, now: number, ctx: QueueContext): TransitionResult {
  const tickCtx: QueueContext = { ...ctx, now }
  const limits = limitsOf(ctx)
  if (record.state === 'reconciling') {
    if (!record.reconcileSince) {
      return {
        record: withState(record, tickCtx, 'reconciling', { reconcileSince: iso(now) }),
        effects: [],
      }
    }
    if (now - Date.parse(record.reconcileSince) >= limits.stuckAfterMs) {
      return { record: enterStuck(record, tickCtx), effects: [] }
    }
    return { record, effects: [] }
  }
  if (record.state === 'reconciling-stuck') {
    // every recheckMs one lookup, never a new attempt
    if (record.retryAt !== undefined && now < Date.parse(record.retryAt)) {
      return { record, effects: [] }
    }
    return {
      record: withState(record, tickCtx, 'reconciling-stuck', { retryAt: recheckStamp(tickCtx) }),
      effects: [{ kind: 'lookup' }],
    }
  }
  return { record, effects: [] }
}

/**
 * One event over one intent. A null record only reacts to `save` (its input
 * carries the minted identity); every other event with no record is a no-op.
 */
export function transition(
  record: IntentRecordV2 | null,
  event: QueueEvent,
  ctx: QueueContext,
): TransitionResult {
  if (!record) {
    if (event.type === 'save') {
      const created = createFromSave(event.intent, ctx)
      return { record: created, effects: [] }
    }
    return { record: null, effects: [] }
  }

  switch (event.type) {
    case 'save':
      return onSave(record, event, ctx)

    case 'dispatch':
      if (record.state !== 'queued') return { record, effects: [] }
      return { record: withState(record, ctx, 'validating', { retryAt: undefined }), effects: [] }

    case 'uploaded':
      if (record.state === 'validating') {
        return { record: withState(record, ctx, 'uploading'), effects: [] }
      }
      if (record.state === 'uploading') {
        return { record: withState(record, ctx, 'committing'), effects: [] }
      }
      return { record, effects: [] }

    case 'committed':
      return onCommitted(record, event.receipt, ctx)

    case 'commitFailed':
      return onCommitFailed(record, event, ctx)

    case 'lookup':
      return onLookup(record, event, ctx)

    case 'pause':
      if (
        record.state === 'queued' ||
        record.state === 'paused_offline' ||
        record.state === 'paused_admin' ||
        record.state === 'paused_user'
      ) {
        return { record: withState(record, ctx, 'paused_user'), effects: [] }
      }
      return { record, effects: [] }

    case 'resume':
      if (record.state !== 'paused_user') return { record, effects: [] }
      return {
        record: withState(record, ctx, ctx.online === false ? 'paused_offline' : 'queued'),
        effects: [],
      }

    case 'capability':
      if (!event.syncWrite) {
        // waiting and in-flight states park; committing runs to its receipt,
        // reconciling and the user-settled states are left alone
        if (!CAPABILITY_PAUSABLE.has(record.state)) return { record, effects: [] }
        return {
          record: withState(record, ctx, 'paused_admin', { retryAt: undefined }),
          effects: [],
        }
      }
      if (record.state !== 'paused_admin') return { record, effects: [] }
      return {
        record: withState(
          record,
          ctx,
          ctx.online === false
            ? 'paused_offline'
            : ctx.pausedUser === true
              ? 'paused_user'
              : 'queued',
          { retryAt: undefined },
        ),
        effects: [],
      }

    case 'online':
      if (!event.online) {
        if (record.state !== 'queued') return { record, effects: [] }
        return { record: withState(record, ctx, 'paused_offline'), effects: [] }
      }
      // coming online never resumes a user pause: it stays `paused_user`
      if (record.state !== 'paused_offline') return { record, effects: [] }
      return {
        record: withState(record, ctx, ctx.pausedUser === true ? 'paused_user' : 'queued'),
        effects: [],
      }

    case 'cancel':
      if (!CANCELLABLE.has(record.state)) return { record, effects: [] }
      return {
        record: withState(record, ctx, 'cancelled', {
          cancelReason: 'user',
          retryAt: undefined,
          reconcileSince: undefined,
          uploadSession: undefined,
        }),
        // the snapshot of a cancelled intent becomes a kept draft when the
        // document is closed; the caller knows whether that applies
        effects: [{ kind: 'keepDraft' }],
      }

    case 'discard':
      if (record.state !== 'reconciling-stuck') return { record, effects: [] }
      return {
        record: withState(record, ctx, 'cancelled', {
          cancelReason: 'user',
          retryAt: undefined,
          reconcileSince: undefined,
          uploadSession: undefined,
        }),
        effects: [{ kind: 'keepDraft' }],
      }

    case 'supersede':
      if (!SUPERSEDABLE.has(record.state)) return { record, effects: [] }
      return {
        record: withState(record, ctx, 'cancelled', {
          cancelReason: 'superseded',
          retryAt: undefined,
          reconcileSince: undefined,
          uploadSession: undefined,
        }),
        effects: [],
      }

    case 'abandon':
      // "Bo nhap..." on a blocked row: the user drops the snapshot of an intent
      // the server will not take; nothing else ever cancels a blocked intent
      if (record.state !== 'blocked') return { record, effects: [] }
      return {
        record: withState(record, ctx, 'cancelled', {
          cancelReason: 'user',
          retryAt: undefined,
          reconcileSince: undefined,
          uploadSession: undefined,
        }),
        effects: [],
      }

    case 'unblock':
      // the condition the record waits on lifted: the same intent - id,
      // snapshot, generation and base untouched - goes back to the waiting
      // queue and commits through the normal path. Only the reason the record
      // is actually blocked on moves: a lift of another condition, a record
      // that is not blocked (a second lift included), and a record nobody named
      // are all no-ops.
      if (record.state !== 'blocked' || record.lastError !== event.reason) {
        return { record, effects: [] }
      }
      return {
        record: withState(record, ctx, waitingState(ctx), {
          lastError: undefined,
          retryAt: undefined,
          reconcileSince: undefined,
        }),
        effects: [],
      }

    case 'tombstone':
      if (isTerminalQueueState(record.state)) return { record, effects: [] }
      return {
        record: withState(record, ctx, 'blocked', {
          lastError: 'document_deleted',
          retryAt: undefined,
          reconcileSince: undefined,
        }),
        effects: [],
      }

    case 'tick':
      return onTick(record, event.now, ctx)
  }
}
