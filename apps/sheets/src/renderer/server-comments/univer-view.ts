/**
 * G8-13 (UNI-1408): the open Univer workbook as the server-comment panel sees it (`SheetsEditorView`).
 * Thin on purpose: every rule lives in the anchor store / adapter, which the tests drive with a fake.
 */
import { focusWorksheet } from '../sheet-focus'
import { revealCellBelowFreeze } from '../univer-sync'
import type { UniverRuntime } from '../univer-state'
import type { WorkbookFile } from '../../shared/desktop-api'
import type { SheetsEditorView } from './adapter'
import { stableSheetId, type LiveSheet } from './anchor-store'

/** live sheet id -> name of the open workbook (taken before a reopen replaces it) */
export function liveSheetNames(runtime: UniverRuntime | null): Map<string, string> {
  const names = new Map<string, string>()
  for (const sheet of runtime?.univerAPI.getActiveWorkbook()?.getSheets() ?? []) {
    names.set(sheet.getSheetId(), sheet.getSheetName())
  }
  return names
}

export function createUniverEditorView(
  getRuntime: () => UniverRuntime | null,
  getFile: () => Pick<WorkbookFile, 'sheets'> | null,
): SheetsEditorView {
  const workbook = () => getRuntime()?.univerAPI.getActiveWorkbook() ?? null
  return {
    sheets(): LiveSheet[] {
      const fileIds = new Set(getFile()?.sheets.map((s) => s.id) ?? [])
      return (workbook()?.getSheets() ?? []).map((sheet) => {
        const id = sheet.getSheetId()
        const stableId = fileIds.has(id) ? stableSheetId(id) : undefined
        return { id, name: sheet.getSheetName(), ...(stableId ? { stableId } : {}) }
      })
    },
    activeSheetId: () => workbook()?.getActiveSheet()?.getSheetId() ?? null,
    selection() {
      const wb = workbook()
      const sheet = wb?.getActiveSheet()
      const range = wb?.getActiveRange()?.getRange()
      if (!sheet || !range) return null
      return {
        sheetId: sheet.getSheetId(),
        range: {
          startRow: range.startRow,
          endRow: range.endRow,
          startColumn: range.startColumn,
          endColumn: range.endColumn,
        },
      }
    },
    select(sheetId, range) {
      const wb = workbook()
      const sheet = wb?.getSheetBySheetId(sheetId)
      if (!wb || !sheet) return
      // the panel item that asked keeps the keyboard focus (spine S12: goTo never steals it)
      const focused = document.activeElement as HTMLElement | null
      try {
        if (wb.getActiveSheet()?.getSheetId() !== sheetId) {
          // explicit navigation: a background load's keepActiveSheet restore must not undo it
          focusWorksheet(sheet, () => wb.setActiveSheet(sheet))
        }
        sheet
          .getRange(
            range.startRow,
            range.startColumn,
            range.endRow - range.startRow + 1,
            range.endColumn - range.startColumn + 1,
          )
          .activate()
        void revealCellBelowFreeze(sheet, range.startRow, range.startColumn)
      } catch {
        // the sheet's render controllers may still be mounting; the selection is best-effort
      }
      if (focused && focused.isConnected && document.activeElement !== focused) {
        focused.focus({ preventScroll: true })
      }
    },
  }
}
