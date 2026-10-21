import { useSyncExternalStore } from 'react'
import type {
  FolderUploadBridge,
  FolderUploadFailure,
  FolderUploadMode,
  FolderUploadPhase,
  FolderUploadProgressEvent,
} from './bridge'

/**
 * UNI-2052: the runs of the folder / multi-file upload, kept outside any
 * screen. The Documents home and the Open dialog each mount the upload layer,
 * and navigating away unmounts it while the run goes on in main: with the runs
 * here, the bar and the report are still there when a screen comes back, and
 * the progress main pushes in between is not lost. Pre-flights waiting for a
 * decision and the open report stay with the screen that shows them.
 */

/** One run the app is showing */
export interface StoredFolderUploadRun {
  runId: string
  mode: FolderUploadMode
  /** the folder's title (folder mode) or the destination's name (files mode) */
  name: string
  targetLabel: string
  phase: FolderUploadPhase
  done: number
  failed: number
  total: number
  rootFolderId?: string
  failures: FolderUploadFailure[]
  /** the run as a whole failed: why (busy, expired, no permission...), for the bar's sentence */
  error?: FolderUploadRunError
}

export type FolderUploadRunError = NonNullable<FolderUploadProgressEvent['error']>

const TERMINAL: readonly FolderUploadPhase[] = ['done', 'canceled', 'failed']
/** events of a run the start call has not named yet are kept for this many runs */
const EARLY_EVENTS_KEPT = 8
const NO_RUNS: readonly StoredFolderUploadRun[] = []

let attached: FolderUploadBridge | null = null
let detach: (() => void) | null = null
let runs: readonly StoredFolderUploadRun[] = NO_RUNS
const early = new Map<string, FolderUploadProgressEvent>()
const listeners = new Set<() => void>()
const settledListeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function applyEvent(event: FolderUploadProgressEvent): void {
  const known = runs.find((run) => run.runId === event.runId)
  if (!known) {
    // the start call has not answered with this id yet: keep the newest event for it
    early.delete(event.runId)
    early.set(event.runId, event)
    while (early.size > EARLY_EVENTS_KEPT) early.delete(early.keys().next().value as string)
    return
  }
  const settledNow = TERMINAL.includes(event.phase) && !TERMINAL.includes(known.phase)
  runs = runs.map((run) =>
    run.runId !== event.runId
      ? run
      : {
          ...run,
          phase: event.phase,
          done: event.done,
          failed: event.failed,
          total: event.total,
          rootFolderId: event.rootFolderId ?? run.rootFolderId,
          name: run.mode === 'folder' ? (event.rootTitle ?? run.name) : run.name,
          failures: event.failures ?? run.failures,
          error: event.error ?? run.error,
        },
  )
  emit()
  if (settledNow) for (const listener of [...settledListeners]) listener()
}

/** Listen to this bridge's progress, for good: a different bridge (tests) starts the store clean */
export function attachFolderUploadStore(bridge: FolderUploadBridge): void {
  if (bridge === attached) return
  resetFolderUploadStore()
  attached = bridge
  detach = bridge.onProgress(applyEvent)
  emit()
}

/** Drop every run and let go of the bridge (a test hook; the app keeps one bridge for its lifetime) */
export function resetFolderUploadStore(): void {
  detach?.()
  detach = null
  attached = null
  runs = NO_RUNS
  early.clear()
}

/** The runs of this bridge; the same array until something changes (a stable snapshot for React) */
export function folderUploadRuns(
  bridge: FolderUploadBridge | null,
): readonly StoredFolderUploadRun[] {
  return bridge !== null && bridge === attached ? runs : NO_RUNS
}

/** Whether any upload bar is on screen, for the zip bar to share the pane with */
export function useFolderUploadBarsShown(): boolean {
  return useSyncExternalStore(subscribeFolderUploadStore, barsShown, barsShown)
}

function barsShown(): boolean {
  return runs.length > 0
}

export function subscribeFolderUploadStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Runs once each time a run settles (done, canceled or failed), while no matter which screen is mounted */
export function onFolderUploadSettled(listener: () => void): () => void {
  settledListeners.add(listener)
  return () => {
    settledListeners.delete(listener)
  }
}

/** A run the start call has just named; progress that beat the answer is applied now */
export function startFolderUploadRun(bridge: FolderUploadBridge, run: StoredFolderUploadRun): void {
  if (bridge !== attached) return
  runs = [...runs, run]
  emit()
  const beat = early.get(run.runId)
  early.delete(run.runId)
  if (beat) applyEvent(beat)
}

export function patchFolderUploadRun(runId: string, patch: Partial<StoredFolderUploadRun>): void {
  runs = runs.map((run) => (run.runId === runId ? { ...run, ...patch } : run))
  emit()
}

export function removeFolderUploadRun(runId: string): void {
  const next = runs.filter((run) => run.runId !== runId)
  if (next.length === runs.length) return
  runs = next
  emit()
}
