import { useCallback, useEffect, useRef, useState } from 'react'
import type { StringKey } from '../locale'
import {
  getFolderUploadBridge,
  type FolderUploadBridge,
  type FolderUploadFailure,
  type FolderUploadMode,
  type FolderUploadPhase,
  type FolderUploadProgressEvent,
  type PreflightSDO,
} from './bridge'

/** Where an upload goes: the folder open on screen, or null for the workspace top (main uses My Folder) */
export interface FolderUploadTarget {
  workspaceId: string
  folderId: string | null
}

/** One run the app is showing: its bar, and its report once it ended with failures */
export interface FolderUploadRun {
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
  /** the report was closed without a retry: the batch is dismissed */
  closeReport(runId: string): void
  retry(runId: string): Promise<void>
  /** × on a bar: a run that ended with failures is dismissed on the server, any other just disappears */
  closeRun(runId: string): void
  clearNotice(): void
  onOpenFolder?: (folderId: string) => void
}

const TERMINAL: readonly FolderUploadPhase[] = ['done', 'canceled', 'failed']
/** events of a run the start call has not named yet are kept for this many runs */
const EARLY_EVENTS_KEPT = 8

/**
 * UNI-2052: the state of the folder / multi-file upload on one screen: the
 * pre-flights waiting for a decision, the runs under way and their reports.
 * Everything heavy happens in main behind the bridge; this only keeps what the
 * screen shows. `onFinished` runs when a run settles (the host may re-read its
 * list; main also invalidates, so a host that listens already can leave it out).
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
  const [foldersAvailable, setFoldersAvailable] = useState(!!bridge && !bridge.foldersAvailable)
  const [queue, setQueue] = useState<readonly PreflightSDO[]>([])
  const [starting, setStarting] = useState(false)
  const [startFailed, setStartFailed] = useState(false)
  const [runs, setRuns] = useState<readonly FolderUploadRun[]>([])
  const [notice, setNotice] = useState<FolderUploadNotice | null>(null)
  const runsRef = useRef(runs)
  runsRef.current = runs
  const early = useRef(new Map<string, FolderUploadProgressEvent>())
  const finished = useRef(onFinished)
  finished.current = onFinished
  const startingRef = useRef(false)

  useEffect(() => {
    if (!bridge?.foldersAvailable) {
      setFoldersAvailable(!!bridge)
      return
    }
    let live = true
    bridge
      .foldersAvailable()
      .then((yes) => live && setFoldersAvailable(yes))
      .catch(() => live && setFoldersAvailable(false))
    return () => {
      live = false
    }
  }, [bridge])

  const applyEvent = useCallback((event: FolderUploadProgressEvent) => {
    const known = runsRef.current.find((run) => run.runId === event.runId)
    if (!known) {
      // the start call has not answered with this id yet: keep the newest event for it
      early.current.delete(event.runId)
      early.current.set(event.runId, event)
      while (early.current.size > EARLY_EVENTS_KEPT) {
        early.current.delete(early.current.keys().next().value as string)
      }
      return
    }
    const settledNow = TERMINAL.includes(event.phase) && !TERMINAL.includes(known.phase)
    setRuns((prev) =>
      prev.map((run) =>
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
            },
      ),
    )
    if (settledNow) finished.current?.()
  }, [])

  useEffect(() => {
    if (!bridge) return
    return bridge.onProgress(applyEvent)
  }, [bridge, applyEvent])

  const stage = useCallback((sdos: readonly PreflightSDO[]) => {
    if (sdos.length === 0) return
    setQueue((prev) => [...prev, ...sdos])
    setStartFailed(false)
  }, [])

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
      try {
        const { runId } = await bridge.start({ preflightId: sdo.preflightId, shareWithWorkspace })
        const run: FolderUploadRun = {
          runId,
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
          reportOpen: false,
        }
        runsRef.current = [...runsRef.current, run]
        setRuns(runsRef.current)
        setQueue((prev) => prev.filter((item) => item.preflightId !== sdo.preflightId))
        // progress that beat the answer
        const beat = early.current.get(runId)
        early.current.delete(runId)
        if (beat) applyEvent(beat)
      } catch {
        setStartFailed(true)
      } finally {
        startingRef.current = false
        setStarting(false)
      }
    },
    [bridge, queue, applyEvent],
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

  const patchRun = useCallback((runId: string, patch: Partial<FolderUploadRun>) => {
    setRuns((prev) => prev.map((run) => (run.runId === runId ? { ...run, ...patch } : run)))
  }, [])

  const removeRun = useCallback((runId: string) => {
    runsRef.current = runsRef.current.filter((run) => run.runId !== runId)
    setRuns(runsRef.current)
  }, [])

  const dismissOnServer = useCallback(
    (runId: string) => {
      void bridge?.dismiss({ runId }).catch(() => undefined)
    },
    [bridge],
  )

  const openReport = useCallback(
    (runId: string) => patchRun(runId, { reportOpen: true }),
    [patchRun],
  )

  const closeReport = useCallback(
    (runId: string) => {
      dismissOnServer(runId)
      removeRun(runId)
    },
    [dismissOnServer, removeRun],
  )

  const retry = useCallback(
    async (runId: string): Promise<void> => {
      if (!bridge) return
      patchRun(runId, { reportOpen: false, phase: 'uploading', failed: 0, failures: [] })
      try {
        await bridge.retry({ runId })
      } catch {
        setNotice({ key: 'fuDlgStartFailed' })
        removeRun(runId)
      }
    },
    [bridge, patchRun, removeRun],
  )

  const closeRun = useCallback(
    (runId: string) => {
      const run = runsRef.current.find((item) => item.runId === runId)
      if (run && run.phase === 'done' && run.failed > 0) dismissOnServer(runId)
      removeRun(runId)
    },
    [dismissOnServer, removeRun],
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
