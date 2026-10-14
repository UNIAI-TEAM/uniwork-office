/**
 * The signed numbers of the durable save queue (OQ-UX2, signed U-15
 * 2026-10-12; EXPERIENCE.md › numbers :1077-1093). One table for the whole
 * queue: the store budget (1 GiB per account) stays the G5-04 layer's, so it
 * is not repeated here.
 */

export const QUEUE_LIMITS = {
  /** kept drafts per document; the next one is refused `drafts_full` */
  draftsPerDocument: 3,
  /** a `reconciling` intent older than this without a verdict is `reconciling-stuck` (1 h) */
  stuckAfterMs: 3_600_000,
  /** how often a `reconciling-stuck` row checks again (15 min) */
  recheckMs: 900_000,
  /** document lock heartbeat (S1 second-window bar) */
  heartbeatMs: 5_000,
  /** a lock without a heartbeat for this long is gone (3 missed beats) */
  goneMs: 15_000,
  /** a `Retry-After` response is honoured up to this long (5 min) */
  retryAfterClampMs: 300_000,
  /** first backoff step of a retried attempt */
  backoffBaseMs: 1_000,
  /** ceiling of the jittered backoff */
  backoffMaxMs: 300_000,
  /** documents dispatched at once */
  concurrency: 2,
} as const

export type QueueLimits = typeof QUEUE_LIMITS
