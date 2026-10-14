/**
 * G8-13 (UNI-1408): the kit anchor adapter for xlsx anchors (`CollabAnchorAdapter`).
 *
 * The kit hands the adapter the anchors of the listed roots; the store maps those objects back to
 * their comment and its live location (which moved with this session's edits). An anchor the
 * store does not know (the composer's new root) is located straight from its sheet + range.
 */
import {
  locateXlsxAnchor,
  resolveSheet,
  stableSheetId,
  type LiveSheet,
  type Located,
  type ServerAnchorStore,
} from './anchor-store'
import type { CollabAnchor, CollabAnchorAdapter } from './seam'
import type { CellRange } from '../threaded-comments'

/** what the adapter needs from the open workbook */
export interface SheetsEditorView {
  /** the sheets in tab order */
  sheets(): LiveSheet[]
  activeSheetId(): string | null
  /** the active sheet's current selection */
  selection(): Located | null
  /** activate the sheet and select the range, without moving keyboard focus */
  select(sheetId: string, range: CellRange): void
}

// rows < 2^20, columns < 2^14: one integer key per cell keeps the sort numeric
const ROW_SPAN = 2 ** 14
const SHEET_SPAN = 2 ** 34
const UNPLACED = Number.MAX_SAFE_INTEGER

export function createSheetsAnchorAdapter(
  store: Pick<ServerAnchorStore, 'idOf' | 'locationOf' | 'knownName'>,
  view: SheetsEditorView,
): CollabAnchorAdapter {
  const where = (anchor: CollabAnchor): Located | null => {
    const id = store.idOf(anchor)
    const tracked = id === undefined ? undefined : store.locationOf(id)
    if (tracked !== undefined) {
      if (!tracked) return null
      return view.sheets().some((s) => s.id === tracked.sheetId) ? tracked : null
    }
    return locateXlsxAnchor(view.sheets(), anchor)
  }
  const activeName = (): string | undefined => {
    const id = view.activeSheetId()
    return view.sheets().find((s) => s.id === id)?.name
  }
  return {
    order(anchor) {
      const at = where(anchor)
      if (!at) return UNPLACED
      const index = view.sheets().findIndex((s) => s.id === at.sheetId)
      return index * SHEET_SPAN + at.range.startRow * ROW_SPAN + at.range.startColumn
    },
    locate: (anchor) => where(anchor) !== null,
    goTo(anchor) {
      const at = where(anchor)
      if (at) view.select(at.sheetId, at.range)
    },
    activeSheet: activeName,
    sheetName(sheet) {
      const live = resolveSheet(view.sheets(), sheet)?.name
      if (live !== undefined) return live
      // a session sheet is keyed by its name: that name is the label
      if (!stableSheetId(sheet)) return sheet
      // a stable id the workbook no longer has: its last known name, else the active sheet's
      // name, which the kit labels as the bare cell (never the raw `sheet-9`)
      return store.knownName(sheet) ?? activeName()
    },
  }
}
