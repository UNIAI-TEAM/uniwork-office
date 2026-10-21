import { useSyncExternalStore } from 'react'
import type {
  ZipDownloadBridge,
  ZipDownloadErrorCode,
  ZipDownloadPhase,
  ZipDownloadProgress,
} from '../../../shared/zip-download-api'
import type { DocListScreen } from '../doclist/columns'
import type { DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import { planZipDownload, type PlannedSkip, type ResultLine } from './zip-plan'

/**
 * UNI-2068: the bulk Download runs, kept outside any screen. A zip is built and saved in main
 * (the save dialog, the server job, the stream to disk); the renderer only keeps what the bar
 * and the result draw. Navigating away unmounts the screen while the run goes on, so the runs
 * live here and the progress main pushes in between is not lost.
 */

export interface StoredZipRun {
  /** the bridge's run id for a zip; a local id for the one-file download */
  id: string
  kind: 'zip' | 'file'
  phase: ZipDownloadPhase
  bytes: number
  totalBytes: number | null
  /** rows in the selection: the "/total" of the result */
  total: number
  /** documents the zip holds (or 1 for the file); known once the run is done */
  ok: number
  /** the rows left out, with the reason: planned here, then the server's own skips */
  lines: ResultLine[]
  /** the file's title (kind `file`) for the done sentence */
  fileName: string | null
  path: string | null
  error: ZipDownloadErrorCode | null
  /** zip: how many ids went into the job (the server's `file_count` is measured against it) */
  sent: number
  planned: PlannedSkip[]
  titles: Record<string, string>
}

const TERMINAL: readonly ZipDownloadPhase[] = ['done', 'canceled', 'failed']
const NO_RUNS: readonly StoredZipRun[] = []
/** events of a run the start call has not named yet are kept for this many runs */
const EARLY_EVENTS_KEPT = 8

let attached: ZipDownloadBridge | null = null
let detach: (() => void) | null = null
let runs: readonly StoredZipRun[] = NO_RUNS
/** starts and downloads waiting on the save dialog or the first answer */
let pending = 0
let localId = 0
const early = new Map<string, ZipDownloadProgress>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

const isTerminal = (run: StoredZipRun) => TERMINAL.includes(run.phase)

function linesOf(run: StoredZipRun, event: ZipDownloadProgress): ResultLine[] {
  return [
    ...run.planned,
    ...event.skipped.map((skip) => ({
      documentId: skip.documentId,
      title: run.titles[skip.documentId] ?? '',
      reason: skip.reason,
    })),
  ]
}

function applyEvent(event: ZipDownloadProgress): void {
  const known = runs.find((run) => run.id === event.runId)
  if (!known) {
    early.delete(event.runId)
    early.set(event.runId, event)
    while (early.size > EARLY_EVENTS_KEPT) early.delete(early.keys().next().value as string)
    return
  }
  if (isTerminal(known)) return
  const lines = linesOf(known, event)
  runs = runs.map((run) =>
    run.id !== event.runId
      ? run
      : {
          ...run,
          phase: event.phase,
          bytes: event.bytes,
          totalBytes: event.totalBytes,
          path: event.path ?? run.path,
          error: event.error?.code ?? run.error,
          lines,
          // what the zip holds: the server's count, else everything sent less what it skipped
          ok:
            event.phase === 'done'
              ? (event.fileCount ?? Math.max(0, run.sent - event.skipped.length))
              : run.ok,
        },
  )
  emit()
}

function attach(bridge: ZipDownloadBridge): void {
  if (bridge === attached) return
  detach?.()
  runs = NO_RUNS
  early.clear()
  attached = bridge
  detach = bridge.onProgress(applyEvent)
}

/** Drop every run and let go of the bridge (a test hook; the app keeps one bridge for its lifetime) */
export function resetZipDownloadStore(): void {
  detach?.()
  detach = null
  attached = null
  runs = NO_RUNS
  pending = 0
  early.clear()
  emit()
}

export function zipRuns(): readonly StoredZipRun[] {
  return runs
}

/** A save dialog is open, a start is on its way, or a run is under way: one Download at a time */
export function isZipDownloadBusy(): boolean {
  return pending > 0 || runs.some((run) => !isTerminal(run))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** the runs, as a stable snapshot for React */
export function useZipRuns(): readonly StoredZipRun[] {
  return useSyncExternalStore(subscribe, zipRuns, zipRuns)
}

export function useZipDownloadBusy(): boolean {
  return useSyncExternalStore(subscribe, isZipDownloadBusy, isZipDownloadBusy)
}

function addRun(run: StoredZipRun): void {
  runs = [...runs, run]
}

const blank = (
  partial: Partial<StoredZipRun> & Pick<StoredZipRun, 'id' | 'kind'>,
): StoredZipRun => ({
  phase: 'building',
  bytes: 0,
  totalBytes: null,
  total: 0,
  ok: 0,
  lines: [],
  fileName: null,
  path: null,
  error: null,
  sent: 0,
  planned: [],
  titles: {},
  ...partial,
})

/**
 * One bulk Download of the selected rows: plan it, then one plain file or one zip job through
 * the bridge (which opens the save dialog first). Resolves true when something came of the
 * press (a run, a result or an error to show), false for a cancelled dialog, an absent bridge,
 * a busy store or a selection with nothing to download.
 */
export async function runZipDownload(input: {
  bridge: ZipDownloadBridge | null
  workspaceId: string
  screen: DocListScreen
  docs: readonly DocumentsHomeDoc[]
}): Promise<boolean> {
  const { bridge, workspaceId, screen, docs } = input
  if (!bridge || isZipDownloadBusy()) return false
  const plan = planZipDownload({ docs, workspaceId, screen })
  if (plan.mode === 'none') {
    // every selected row was left out: show why instead of a press that does nothing
    if (plan.skipped.length === 0) return false
    addRun(
      blank({
        id: `none-${++localId}`,
        kind: 'file',
        phase: 'done',
        total: docs.length,
        planned: plan.skipped,
        lines: plan.skipped,
      }),
    )
    return true
  }
  attach(bridge)

  pending += 1
  emit()
  try {
    if (plan.mode === 'file') {
      const doc = plan.doc
      const res = await bridge
        .downloadFile({ workspaceId, documentId: doc.id, suggestedName: doc.title })
        .catch(() => ({ ok: false, path: null, code: 'network' as const }))
      if (!res.ok && res.code === 'dialog_canceled') return false
      const base = blank({
        id: `file-${++localId}`,
        kind: 'file',
        total: docs.length,
        fileName: doc.title,
        planned: plan.skipped,
      })
      addRun(
        res.ok
          ? { ...base, phase: 'done', ok: 1, path: res.path, lines: plan.skipped }
          : {
              ...base,
              phase: 'failed',
              error: res.code && res.code !== 'dialog_canceled' ? res.code : 'server_error',
              lines: [
                {
                  documentId: doc.id,
                  title: doc.title,
                  reason: res.code === 'too_large' ? 'too_large' : 'failed',
                },
                ...plan.skipped,
              ],
            },
      )
      return true
    }

    const res = await bridge
      .start({ workspaceId, documentIds: plan.docs.map((doc) => doc.id) })
      .catch(() => ({ ok: false as const, code: 'network' as const }))
    if (!res.ok && res.code === 'dialog_canceled') return false
    const base = blank({
      id: res.ok ? res.runId : `zip-${++localId}`,
      kind: 'zip',
      total: docs.length,
      sent: plan.docs.length,
      planned: plan.skipped,
      lines: plan.skipped,
      titles: Object.fromEntries(docs.map((doc) => [doc.id, doc.title])),
    })
    if (!res.ok) {
      addRun({ ...base, phase: 'failed', error: res.code === 'dialog_canceled' ? null : res.code })
      return true
    }
    addRun(base)
    const beat = early.get(res.runId)
    early.delete(res.runId)
    if (beat) applyEvent(beat)
    return true
  } finally {
    pending -= 1
    emit()
  }
}

export async function cancelZipRun(runId: string): Promise<void> {
  const run = runs.find((r) => r.id === runId)
  if (!run || run.kind !== 'zip' || isTerminal(run)) return
  try {
    await attached?.cancel(runId)
  } catch {
    // main settles the run with its own pushed phase; nothing to undo here
  }
}

/** Remove a settled run from the screen; a run under way stays */
export function closeZipRun(runId: string): void {
  const next = runs.filter((run) => run.id !== runId || !isTerminal(run))
  if (next.length === runs.length) return
  runs = next
  emit()
}
