import { useSyncExternalStore } from 'react'
import type {
  FolderContentsAccessBatch,
  ShareResult,
  UniworkShareApi,
} from '../../../shared/share-api'

/**
 * UNI-2244: the background runs of "share the documents inside a folder", kept outside any
 * screen. The server works through the folder in the background (202); the renderer only polls
 * the batch and draws it. Closing the dialog, or leaving the screen, does not cancel the run, so
 * the runs and their timers live here, like the bulk Download's. A tracked batch is polled until
 * the server says `completed` / `failed`; a batch nobody can read any more (404) or that the
 * network keeps refusing ends as `failed` here (the run itself is the server's, not ours).
 */

export type FolderBatchPhase = 'running' | 'completed' | 'failed'

export interface StoredFolderBatch {
  batchId: string
  folderId: string
  /** the folder's title for the bar and the toast */
  folderTitle: string
  phase: FolderBatchPhase
  total: number
  processed: number
  changed: number
  unchanged: number
  skippedNotManageable: number
  skippedLocked: number
}

/** how often a running batch is read (the spec: about every 2 s) */
export const FOLDER_BATCH_POLL_MS = 2000
/** read failures in a row after which the poll gives up (about 20 s of a dead network) */
export const FOLDER_BATCH_MAX_FAILURES = 10

const NO_BATCHES: readonly StoredFolderBatch[] = []
let batches: readonly StoredFolderBatch[] = NO_BATCHES
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const failures = new Map<string, number>()
const listeners = new Set<() => void>()
/** told once for every batch that ends: the bar turns it into a toast */
const settledListeners = new Set<(batch: StoredFolderBatch) => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function patch(batchId: string, change: Partial<StoredFolderBatch>): StoredFolderBatch | null {
  const index = batches.findIndex((b) => b.batchId === batchId)
  if (index < 0) return null
  const next = { ...batches[index]!, ...change }
  batches = [...batches.slice(0, index), next, ...batches.slice(index + 1)]
  emit()
  return next
}

function settle(
  batchId: string,
  phase: 'completed' | 'failed',
  change: Partial<StoredFolderBatch>,
) {
  stopTimer(batchId)
  const done = patch(batchId, { ...change, phase })
  if (done) for (const listener of [...settledListeners]) listener(done)
}

function stopTimer(batchId: string): void {
  const timer = timers.get(batchId)
  if (timer !== undefined) clearTimeout(timer)
  timers.delete(batchId)
  failures.delete(batchId)
}

function fromBatch(batch: FolderContentsAccessBatch): Partial<StoredFolderBatch> {
  return {
    total: batch.total,
    processed: batch.processed,
    changed: batch.changed,
    unchanged: batch.unchanged,
    skippedNotManageable: batch.skippedNotManageable,
    skippedLocked: batch.skippedLocked,
  }
}

async function poll(api: UniworkShareApi, folderId: string, batchId: string): Promise<void> {
  let answer: ShareResult<FolderContentsAccessBatch>
  try {
    answer = await api.folderContentsAccessBatch({ folderId, batchId })
  } catch {
    answer = { ok: false, error: 'network' }
  }
  // closed (or replaced) while the call was out
  if (!timers.has(batchId)) return
  if (answer.ok) {
    failures.set(batchId, 0)
    const change = fromBatch(answer.value)
    if (answer.value.status === 'completed') return settle(batchId, 'completed', change)
    if (answer.value.status === 'failed') return settle(batchId, 'failed', change)
    patch(batchId, change)
  } else if (answer.error === 'not_found' || answer.error === 'forbidden') {
    // the batch is not this person's (any more): there is nothing left to follow
    return settle(batchId, 'failed', {})
  } else {
    const count = (failures.get(batchId) ?? 0) + 1
    failures.set(batchId, count)
    if (count >= FOLDER_BATCH_MAX_FAILURES) return settle(batchId, 'failed', {})
  }
  schedule(api, folderId, batchId)
}

function schedule(api: UniworkShareApi, folderId: string, batchId: string): void {
  timers.set(
    batchId,
    setTimeout(() => void poll(api, folderId, batchId), FOLDER_BATCH_POLL_MS),
  )
}

export interface TrackFolderBatchInput {
  api: UniworkShareApi
  batchId: string
  folderId: string
  folderTitle: string
  /** 0 when unknown (a batch followed after a 409): the first read fills it in */
  total: number
}

/** start following a batch; following one that is already tracked does nothing */
export function trackFolderBatch(input: TrackFolderBatchInput): void {
  if (batches.some((b) => b.batchId === input.batchId && b.phase === 'running')) return
  batches = [
    ...batches.filter((b) => b.batchId !== input.batchId),
    {
      batchId: input.batchId,
      folderId: input.folderId,
      folderTitle: input.folderTitle,
      phase: 'running',
      total: input.total,
      processed: 0,
      changed: 0,
      unchanged: 0,
      skippedNotManageable: 0,
      skippedLocked: 0,
    },
  ]
  emit()
  stopTimer(input.batchId)
  // the first read is immediate: a 409 follower has no numbers yet
  timers.set(
    input.batchId,
    setTimeout(() => void poll(input.api, input.folderId, input.batchId), 0),
  )
}

/** drop a finished batch's bar */
export function closeFolderBatch(batchId: string): void {
  stopTimer(batchId)
  batches = batches.filter((b) => b.batchId !== batchId)
  emit()
}

/** told when a batch ends; returns the unsubscribe */
export function onFolderBatchSettled(listener: (batch: StoredFolderBatch) => void): () => void {
  settledListeners.add(listener)
  return () => settledListeners.delete(listener)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** the tracked batches, oldest first */
export function useFolderBatches(): readonly StoredFolderBatch[] {
  return useSyncExternalStore(
    subscribe,
    () => batches,
    () => NO_BATCHES,
  )
}

/** tests: forget every batch and timer */
export function resetFolderBatchesForTest(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  failures.clear()
  batches = NO_BATCHES
  settledListeners.clear()
  emit()
}
