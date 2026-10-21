// The compact `picker` variant of the Documents list (Open dialog, folder
// browser): Tên with a second line · Người sửa gần nhất · Cập nhật. No Chọn,
// Truy cập, Dung lượng or Thao tác column: a picker chooses one document and
// the row's own buttons sit beside it. PickerList draws; this decides.
import type { DocSubline } from './DocRow'

export type PickerColumnId = 'name' | 'editor' | 'updated'

/** the columns in their fixed order, widest layout */
export const PICKER_COLUMNS: readonly PickerColumnId[] = ['name', 'editor', 'updated']

const REM = 16
/** the room Tên keeps before Người sửa joins */
const NAME_FLOOR = 168
/** fixed cell widths in px, cell padding included */
const WIDTH = { editor: 112, updated: 116 }
/** what a row keeps clear for the buttons beside it (Details and "…" in the dialog) */
const BUTTONS = 76
/** the row's own padding, both sides */
const PADDING = 16

/**
 * List width (px) Người sửa needs to show: every column + the buttons' room +
 * the padding, rounded up to the next rem. Under it the editor moves under the
 * title (see `pickerSublineOf`). Tên and Cập nhật never hide.
 */
export const PICKER_EDITOR_RUNG =
  Math.ceil((NAME_FLOOR + WIDTH.editor + WIDTH.updated + BUTTONS + PADDING) / REM) * REM

/** the columns at a list width in px; no (or an unusable) width means all of them */
export function pickerColumnsFor(width?: number): PickerColumnId[] {
  const w = typeof width === 'number' && Number.isFinite(width) ? width : Number.POSITIVE_INFINITY
  return w >= PICKER_EDITOR_RUNG ? [...PICKER_COLUMNS] : ['name', 'updated']
}

const TRACK: Record<PickerColumnId, string> = {
  name: `minmax(${NAME_FLOOR}px, 1fr)`,
  editor: `minmax(${WIDTH.editor - 8}px, 0.7fr)`,
  updated: `${WIDTH.updated}px`,
}

/** the grid tracks of a row and of the header above it */
export function pickerTrackOf(columns: readonly PickerColumnId[]): string {
  return columns.map((column) => TRACK[column]).join(' ')
}

/**
 * The second line under a title. While Người sửa is a column it stays as the
 * host gave it; once the column is gone the editor's name goes under the
 * title (after the host's own text) so the row still says who edited it. A
 * folder path is never extended, and no name is ever invented.
 */
export function pickerSublineOf(
  subline: DocSubline | null,
  editorName: string | null,
  editorShown: boolean,
): DocSubline | null {
  if (editorShown || !editorName) return subline
  if (!subline) return { short: editorName, full: editorName }
  if (subline.path) return subline
  return {
    short: `${subline.short} · ${editorName}`,
    full: `${subline.full} · ${editorName}`,
  }
}
