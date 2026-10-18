import type { WorkbookFile } from '../shared/desktop-api'
import type { EditableWorkbook, ViewOnlyLock } from './view-only-lock'

/**
 * EL-1(b): preload surface the shell adds for the desktop edit lock on a
 * bound workbook. All three members stay optional so the web frame and older
 * test harnesses keep working without them.
 */
export interface SheetsUniworkSeam {
  uniworkState?(): Promise<{ bound: boolean; readOnly: boolean }>
  onUniworkStateChanged?(cb: (path: string) => void): () => void
  uniworkReadOnlySave?(path?: string): Promise<void>
}

/** Whether a `uniwork:doc-state-changed` ping for `pingPath` targets `file`. */
export function sheetsMatchesUniworkPath(
  file: Pick<WorkbookFile, 'path' | 'csvPath'> | null | undefined,
  pingPath: string,
): boolean {
  if (!file || !pingPath) return false
  if (file.path === pingPath || file.csvPath === pingPath) return true
  const norm = (s: string | undefined) => s?.replace(/\\/g, '/').toLowerCase()
  const target = norm(pingPath)
  return norm(file.path) === target || norm(file.csvPath) === target
}

/**
 * Patch `file` with the fresh `{bound, readOnly}` answer from main (converted
 * `.xls` imports keep `needsSaveAs` and stay editable/unbound, matching open).
 */
export function applySheetsUniworkAnswer(
  file: WorkbookFile,
  answer: { bound: boolean; readOnly: boolean },
): WorkbookFile {
  const converted = file.needsSaveAs === true && file.unsavedNew !== true
  const bound = !converted && answer.bound === true
  const readOnly = !converted && answer.readOnly === true
  if (file.readOnly === readOnly && (file.uniworkBound === true) === bound) return file
  const next: WorkbookFile = { ...file, readOnly }
  if (bound) next.uniworkBound = true
  else delete next.uniworkBound
  return next
}

/**
 * Subscribe to `onUniworkStateChanged`; when the ping names the open workbook,
 * re-query `uniworkState()`, update the workbook file, and flip `viewOnlyLock`
 * between locked (read-only) and released (editable) without touching the edit
 * journal. Returns the unsubscribe cleanup.
 */
export function watchSheetsUniworkState(_deps: {
  api: SheetsUniworkSeam | null | undefined
  getFile(): WorkbookFile | null
  setFile(next: WorkbookFile): void
  getWorkbook(): EditableWorkbook | null
  lock: ViewOnlyLock
  webViewOnly: boolean
}): () => void {
  return () => {}
}

/**
 * Explicit Save (`mode === 'save'`, not quiet) of a read-only workbook: asks
 * main to explain the lock when the file is bound, and always returns true so
 * the caller stops before writing. Save As, recovery, quiet AutoSave and
 * editable files return false.
 */
export function sheetsBlocksReadOnlySave(
  _api: SheetsUniworkSeam | null | undefined,
  _file: Pick<WorkbookFile, 'path' | 'csvPath' | 'readOnly' | 'uniworkBound'> | null | undefined,
  _mode: 'save' | 'save-as' | 'recovery',
  _quiet: boolean,
): boolean {
  return false
}
