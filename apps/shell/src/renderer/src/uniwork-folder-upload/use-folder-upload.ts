import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { StringKey } from '../locale'
import {
  getFolderUploadBridge,
  type FolderUploadBridge,
  type FolderUploadMode,
  type PreflightSDO,
} from './bridge'
import {
  attachFolderUploadStore,
  folderUploadRuns,
  onFolderUploadSettled,
  patchFolderUploadRun,
  removeFolderUploadRun,
  startFolderUploadRun,
  subscribeFolderUploadStore,
  type StoredFolderUploadRun,
} from './folder-upload-store'

/** Where an upload goes: the folder open on screen, or null for the workspace top (main uses My Folder) */
export interface FolderUploadTarget {
  workspaceId: string
  folderId: string | null
}

/** One run the app is showing: its bar, and its report once it ended with failures */
export interface FolderUploadRun extends StoredFolderUploadRun {
  /** this screen has the run's report open (the report belongs to the screen that asked for it) */
  reportOpen: boolean
}

export interface FolderUploadNotice {
  key: StringKey
}

export interface FolderUploadController {
  /** this main has the bridge: files can be picked and dropped in numbers */
  available: boolean
  /** "Tải lên thư mục" is offered (the bridge says the server takes folders) */
  foldersAvailable: boolean
  /** open the picker and stage its pre-flight; true when something was staged */
  pick(target: FolderUploadTarget, mode: FolderUploadMode): Promise<boolean>
  /** stage the pre-flights of dropped absolute paths (loose files first, then each folder) */
  drop(target: FolderUploadTarget, paths: string[]): Promise<void>
  /** a sentence the layer shows once as a notice (a drop it could not take) */
  notify(key: StringKey): void
  // the layer's side
  queue: readonly PreflightSDO[]
  starting: boolean
  startFailed: boolean
  runs: readonly FolderUploadRun[]
  notice: FolderUploadNotice | null
  submit(options: { shareWithWorkspace: boolean }): Promise<void>
  cancelDialog(): void
  cancelRun(runId: string): void
  openReport(runId: string): void
  /** Esc, the overlay or "Close" on the report: only the report goes, the bar and the batch stay */
  closeReport(runId: string): void
  retry(runId: string): Promise<void>
  /** × on a bar: a run that ended with failures is dismissed on the server, any other just disappears */
  closeRun(runId: string): void
  clearNotice(): void
  onOpenFolder?: (folderId: string) => void
}

/** A single file with nothing to explain starts at once: no dialog, no share choice (private, like a plain upload) */
function startsAtOnce(sdo: PreflightSDO): boolean {
  return (
    sdo.mode === 'files' &&
    sdo.totals.files === 1 &&
    sdo.refusal === null &&
    sdo.skipped.length === 0
  )
}

/**
 * UNI-2052: the folder / multi-file upload on one screen: the pre-flights
 * waiting for a decision and the open report. The runs themselves are in the
 * module-level store, so they outlive the screen. Everything heavy happens in
 * main behind the bridge. `onFinished` runs when a run settles (the host may
 * re-read its list; main also invalidates, so a host that listens already can
 * leave it out).
 */
export function useFolderUpload({
  onFinished,
  onOpenFolder,
  bridge: injected,
}: {
  onFinished?: () => void
  onOpenFolder?: (folderId: string) => void
  /** tests hand a fake in; the app reads `window.uniworkFolderUpload` */
  bridge?: FolderUploadBridge | null
}): FolderUploadController {
  const bridge = injected === undefined ? getFolderUploadBridge() : injected
  const [foldersAvailable, setFoldersAvailable] = useState(false)
  const [queue, setQueue] = useState<readonly PreflightSDO[]>([])
  const [starting, setStarting] = useState(false)
  const [startFailed, setStartFailed] = useState(false)
  const stored = useSyncExternalStore(subscribeFolderUploadStore, () => folderUploadRuns(bridge))
  const [reportRunId, setReportRunId] = useState<string | null>(null)
  const [notice, setNotice] = useState<FolderUploadNotice | null>(null)
  const runs = useMemo<readonly FolderUploadRun[]>(
    () => stored.map((run) => ({ ...run, reportOpen: run.runId === reportRunId })),
    [stored, reportRunId],
  )
  const finished = useRef(onFinished)
  finished.current = onFinished
  const startingRef = useRef(false)

  useEffect(() => {
    if (!bridge) return
    let live = true
    bridge
      .foldersAvailable()
      .then((yes) => live && setFoldersAvailable(yes))
      .catch(() => live && setFoldersAvailable(false))
    return () => {
      live = false
    }
  }, [bridge])

  // the store listens to main for good; this screen only has to be told when a run settles
  useEffect(() => {
    if (bridge) attachFolderUploadStore(bridge)
  }, [bridge])

  useEffect(() => onFolderUploadSettled(() => finished.current?.()), [])

  /** names the run the start call answered; false when main refused or the call failed */
  const begin = useCallback(
    async (sdo: PreflightSDO, shareWithWorkspace: boolean): Promise<boolean> => {
      if (!bridge) return false
      try {
        const result = await bridge.start({ preflightId: sdo.preflightId, shareWithWorkspace })
        if (!result.ok) return false
        startFolderUploadRun(bridge, {
          runId: result.runId,
          mode: sdo.mode,
          name:
            sdo.mode === 'folder'
              ? (sdo.rootNamePreview ?? sdo.rootName ?? sdo.target.label)
              : sdo.target.label,
          targetLabel: sdo.target.label,
          phase: 'planning',
          done: 0,
          failed: 0,
          total: sdo.totals.files,
          failures: [],
        })
        return true
      } catch {
        return false
      }
    },
    [bridge],
  )

  const stage = useCallback(
    (sdos: readonly PreflightSDO[]) => {
      if (sdos.length === 0) return
      const waiting = sdos.filter((sdo) => !startsAtOnce(sdo))
      for (const sdo of sdos) {
        if (startsAtOnce(sdo)) {
          void begin(sdo, false).then((started) => {
            if (!started) setNotice({ key: 'fuDlgStartFailed' })
          })
        }
      }
      if (waiting.length === 0) return
      setQueue((prev) => [...prev, ...waiting])
      setStartFailed(false)
    },
    [begin],
  )

  const notify = useCallback((key: StringKey) => setNotice({ key }), [])

  const pick = useCallback(
    async (target: FolderUploadTarget, mode: FolderUploadMode): Promise<boolean> => {
      if (!bridge) return false
      try {
        // only the contract's fields cross: a caller's target may carry more (a folder path for a label)
        const sdo = await bridge.pick({
          workspaceId: target.workspaceId,
          folderId: target.folderId,
          mode,
        })
        if (!sdo) return false
        stage([sdo])
        return true
      } catch {
        setNotice({ key: 'fuPickFailed' })
        return false
      }
    },
    [bridge, stage],
  )

  const drop = useCallback(
    async (target: FolderUploadTarget, paths: string[]): Promise<void> => {
      if (!bridge || paths.length === 0) return
      try {
        stage(
          await bridge.preflight({
            workspaceId: target.workspaceId,
            folderId: target.folderId,
            paths,
          }),
        )
      } catch {
        setNotice({ key: 'fuPickFailed' })
      }
    },
    [bridge, stage],
  )

  const submit = useCallback(
    async ({ shareWithWorkspace }: { shareWithWorkspace: boolean }): Promise<void> => {
      const sdo = queue[0]
      if (!bridge || !sdo || startingRef.current) return
      startingRef.current = true
      setStarting(true)
      setStartFailed(false)
      // a switch that does not reach the server (the one-by-one fallback) is never sent as ON
      const started = await begin(sdo, shareWithWorkspace && sdo.shareAvailable)
      if (started) setQueue((prev) => prev.filter((item) => item.preflightId !== sdo.preflightId))
      else setStartFailed(true)
      startingRef.current = false
      setStarting(false)
    },
    [bridge, queue, begin],
  )

  const cancelDialog = useCallback(() => {
    if (startingRef.current) return
    setStartFailed(false)
    setQueue((prev) => prev.slice(1))
  }, [])

  const cancelRun = useCallback(
    (runId: string) => {
      void bridge?.cancel({ runId }).catch(() => undefined)
    },
    [bridge],
  )

  const dismissOnServer = useCallback(
    (runId: string) => {
      void bridge?.dismiss({ runId }).catch(() => undefined)
    },
    [bridge],
  )

  const openReport = useCallback((runId: string) => setReportRunId(runId), [])

  const closeReport = useCallback((runId: string) => {
    setReportRunId((open) => (open === runId ? null : open))
  }, [])

  const retry = useCallback(
    async (runId: string): Promise<void> => {
      if (!bridge) return
      setReportRunId((open) => (open === runId ? null : open))
      patchFolderUploadRun(runId, { phase: 'uploading', failed: 0, failures: [], error: undefined })
      try {
        await bridge.retry({ runId })
      } catch {
        setNotice({ key: 'fuDlgStartFailed' })
        removeFolderUploadRun(runId)
      }
    },
    [bridge],
  )

  const closeRun = useCallback(
    (runId: string) => {
      const run = folderUploadRuns(bridge).find((item) => item.runId === runId)
      if (run && run.phase === 'done' && run.failed > 0) dismissOnServer(runId)
      removeFolderUploadRun(runId)
    },
    [bridge, dismissOnServer],
  )

  const clearNotice = useCallback(() => setNotice(null), [])

  return {
    available: !!bridge,
    foldersAvailable,
    pick,
    drop,
    notify,
    queue,
    starting,
    startFailed,
    runs,
    notice,
    submit,
    cancelDialog,
    cancelRun,
    openReport,
    closeReport,
    retry,
    closeRun,
    clearNotice,
    onOpenFolder,
  }
}
