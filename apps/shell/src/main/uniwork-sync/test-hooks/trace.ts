/**
 * Test-only intent state transition trace for the UniWork durable save queue (G7-03a).
 *
 * Environment variables (test-only, off by default):
 * - `UNIWORK_SYNC_TRACE_FILE`: when set in an unpackaged build, appends one
 *   JSON line per intent state transition:
 *   `{ts, intentId, documentId, from, to, httpStatus?, code?}`.
 *   Never writes document content, titles, file names/paths, user ids/emails,
 *   tokens, idempotency keys, or URLs. Off (no file created, no cost) when unset.
 * - `UNIWORK_SYNC_TEST_STUCK_AFTER_MS`: positive integer override for
 *   `QUEUE_LIMITS.stuckAfterMs` (requires `UNIWORK_SYNC_TRACE_FILE`).
 * - `UNIWORK_SYNC_TEST_RECHECK_MS`: positive integer override for
 *   `QUEUE_LIMITS.recheckMs` (requires `UNIWORK_SYNC_TRACE_FILE`).
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { UniworkDocError } from '../../uniwork-docs/errors'
import type { QueueEvent } from '../queue/machine'
import { isQueueState, type IntentRecordV2, type QueueState } from '../queue/record'
import { resolveSyncTraceFile, type TestHookEnvOptions } from './limits'

export interface IntentTraceLine {
  ts: string
  intentId: string
  documentId: string
  from: QueueState | null
  to: QueueState
  httpStatus?: number
  code?: string
}

export interface IntentTraceInput {
  ts?: string | number
  intentId: string
  documentId: string
  from: QueueState | null
  to: QueueState
  httpStatus?: number
  code?: string
}

function toIsoTimestamp(ts: string | number | undefined): string {
  if (typeof ts === 'number' && Number.isFinite(ts)) return new Date(ts).toISOString()
  if (typeof ts === 'string' && ts.length > 0) return ts
  return new Date().toISOString()
}

function toHttpStatus(status: unknown): number | undefined {
  return typeof status === 'number' && Number.isSafeInteger(status) && status > 0
    ? status
    : undefined
}

function toErrorCode(code: unknown): string | undefined {
  return typeof code === 'string' && code.length > 0 ? code : undefined
}

/**
 * Appends one sanitized JSONL line to `UNIWORK_SYNC_TRACE_FILE` when enabled.
 * Only the allowlisted keys `{ts, intentId, documentId, from, to, httpStatus?, code?}`
 * are ever serialized.
 */
export function traceIntentTransition(
  input: IntentTraceInput,
  options: TestHookEnvOptions = {},
): void {
  const file = resolveSyncTraceFile(options)
  if (!file) return
  if (
    typeof input.intentId !== 'string' ||
    !input.intentId ||
    typeof input.documentId !== 'string' ||
    !input.documentId ||
    typeof input.to !== 'string' ||
    !input.to
  ) {
    return
  }
  const httpStatus = toHttpStatus(input.httpStatus)
  const code = toErrorCode(input.code)
  const line: IntentTraceLine = {
    ts: toIsoTimestamp(input.ts),
    intentId: String(input.intentId),
    documentId: String(input.documentId),
    from: input.from ?? null,
    to: input.to,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(code !== undefined ? { code } : {}),
  }
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(line)}\n`, 'utf8')
  } catch {
    // Tracing is best-effort for fault tests and must never break queue execution.
  }
}

function extractAttemptMeta(
  record: IntentRecordV2,
  event: QueueEvent,
  cause: unknown,
): { httpStatus?: number; code?: string } {
  const errStatus = cause instanceof UniworkDocError ? toHttpStatus(cause.status) : undefined
  if (event.type === 'committed') {
    return { httpStatus: 200 }
  }
  if (event.type === 'commitFailed') {
    return {
      ...(errStatus !== undefined ? { httpStatus: errStatus } : {}),
      code: record.lastError ?? event.error,
    }
  }
  if (event.type === 'lookup') {
    if ('outcome' in event) {
      if (event.outcome === 'unknown') {
        return { httpStatus: 410, code: 'commit_intent_unknown' }
      }
      return { httpStatus: 200, code: event.outcome }
    }
    return {
      ...(errStatus !== undefined ? { httpStatus: errStatus } : {}),
      code: record.lastError ?? event.error,
    }
  }
  return {}
}

/**
 * Hook called from `QueueDispatcher` when an intent is enqueued or transitioned.
 */
export function traceQueueTransition(
  from: QueueState | null,
  record: IntentRecordV2,
  event: QueueEvent,
  now: number,
  cause?: unknown,
  options: TestHookEnvOptions = {},
): void {
  if (!resolveSyncTraceFile(options)) return
  if (from === record.state && event.type !== 'lookup' && event.type !== 'commitFailed') {
    return
  }
  const meta = extractAttemptMeta(record, event, cause)
  traceIntentTransition(
    {
      ts: now,
      intentId: record.intentId,
      documentId: record.documentId,
      from,
      to: record.state,
      ...meta,
    },
    options,
  )
}

export type CoordinatorTraceEvent =
  | { type: 'minted' }
  | { type: 'settled'; now: Date }
  | { type: 'failed'; error: UniworkDocError; to: string; now: Date }

/** The coordinator's own end state (a binding state) as a queue state for the trace. */
function traceStateOf(state: string): QueueState {
  if (isQueueState(state)) return state
  return state === 'offline' ? 'paused_offline' : 'failed'
}

/**
 * Hook called from `SaveCoordinator` when an inline Save mints, settles, or
 * fails an intent.
 */
export function traceCoordinatorTransition(
  intent: IntentRecordV2,
  event: CoordinatorTraceEvent,
  options: TestHookEnvOptions = {},
): void {
  if (!resolveSyncTraceFile(options)) return
  if (event.type === 'minted') {
    traceIntentTransition(
      {
        ts: intent.updatedAt,
        intentId: intent.intentId,
        documentId: intent.documentId,
        from: null,
        to: intent.state,
      },
      options,
    )
    return
  }
  if (event.type === 'settled') {
    traceIntentTransition(
      {
        ts: event.now.toISOString(),
        intentId: intent.intentId,
        documentId: intent.documentId,
        from: intent.state,
        to: 'committed',
        httpStatus: 200,
      },
      options,
    )
    return
  }
  const to = traceStateOf(event.to)
  const code = event.error.code
  traceIntentTransition(
    {
      ts: event.now.toISOString(),
      intentId: intent.intentId,
      documentId: intent.documentId,
      from: intent.state,
      to,
      ...(event.error.status !== undefined ? { httpStatus: event.error.status } : {}),
      code,
    },
    options,
  )
}
