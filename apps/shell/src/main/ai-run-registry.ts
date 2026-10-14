/**
 * Which editor webContents has an AI turn running, as each editor's preload
 * reports it over AI_RUN_CHANNEL (window.uniworkAiRun.reportAiRun). Keyed by
 * webContents.id like the modules' dirty flags (pdfIsDirty,
 * sheetsPendingEditCount), so tabs, detached windows and Present tabs all read
 * the same answer for the view that sent it.
 *
 * Nothing emits yet beyond the bridge, and nothing acts on the flag here: the
 * shell only exposes it through TabManager.editorDirtyStates and
 * detachedEditorStates.
 */
import type { IpcMain, IpcMainEvent, WebContents } from 'electron'
import { AI_RUN_CHANNEL, parseAiRunReport } from '@genoffice/electron-utils/ai-run'

/** one editor's answer to the shell's per-document poll (editorDirtyStates) */
export interface EditorState {
  path: string
  /** null: the editor did not answer, the caller keeps what it last knew */
  dirty: boolean | null
  aiRunning: boolean
  /**
   * G5-03a: how many AI turns this view has started since the shell first
   * saw it (never decreases). The guarded clean reload reads the SUM over a
   * document's views before and after its download: a change means a turn
   * started meanwhile, so the fetched bytes must not be written.
   */
  aiEpoch: number
}

/** webContents.id -> id of the running turn ('' when the editor sent none) */
const runningByWc = new Map<number, string>()
/**
 * webContents.id -> number of `running` reports accepted so far. Kept apart
 * from runningByWc: the flag is cleared by an idle / reload / crash, while the
 * count only ever grows (the reload race compares it across a fetch).
 */
const epochByWc = new Map<number, number>()
/** views whose destroy/reload/crash already clears the flag */
const watched = new Set<number>()

export function isAiRunning(webContentsId: number): boolean {
  return runningByWc.has(webContentsId)
}

/** How many AI turns this view has started (0 when the shell never saw one). */
export function aiEpochOf(webContentsId: number): number {
  return epochByWc.get(webContentsId) ?? 0
}

/** Apply one report from `sender`; false when the payload is malformed (ignored). */
export function noteAiRun(sender: WebContents, payload: unknown): boolean {
  const report = parseAiRunReport(payload)
  if (!report) return false
  const wcId = sender.id
  if (report.state === 'running') {
    if (sender.isDestroyed()) return true
    watch(sender)
    runningByWc.set(wcId, report.runId ?? '')
    epochByWc.set(wcId, aiEpochOf(wcId) + 1)
    return true
  }
  // an 'idle' naming an older turn does not end the current one
  const current = runningByWc.get(wcId)
  if (report.runId && current && report.runId !== current) return true
  runningByWc.delete(wcId)
  return true
}

/** Forget `webContentsId` (closed view, reload). */
export function clearAiRun(webContentsId: number): void {
  runningByWc.delete(webContentsId)
}

function watch(wc: WebContents): void {
  const wcId = wc.id
  if (watched.has(wcId)) return
  watched.add(wcId)
  wc.once('destroyed', () => {
    runningByWc.delete(wcId)
    // the view is gone for good: its epoch goes with it
    epochByWc.delete(wcId)
    watched.delete(wcId)
  })
  // reload() remounts the renderer without destroying webContents: the turn is gone
  wc.on('did-start-loading', () => runningByWc.delete(wcId))
  // a crashed renderer keeps its webContents (and may be reloaded later): the turn is gone
  wc.on('render-process-gone', () => runningByWc.delete(wcId))
}

export function registerAiRunIpc(ipc: Pick<IpcMain, 'on'>): void {
  ipc.on(AI_RUN_CHANNEL, (event: IpcMainEvent, payload: unknown) => {
    noteAiRun(event.sender, payload)
  })
}

/** Test seam: drop every flag. */
export function resetAiRunRegistry(): void {
  runningByWc.clear()
  epochByWc.clear()
  watched.clear()
}
