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
export const PICKER_BUTTONS = 76
/** the row's own padding, both sides */
const PADDING = 16

/** the room a coarse pointer adds to the buttons beside a row (the CSS grows --pick-trail by it) */
export const PICKER_COARSE_EXTRA = 28

/**
 * List width (px) Người sửa needs to show: every column + the room the host
 * keeps clear for its buttons (`reserve`) + the padding, rounded up to the
 * next rem. Under it the editor moves under the title (see `pickerSublineOf`).
 * Tên and Cập nhật never hide.
 */
export function pickerEditorRungFor(reserve: number = PICKER_BUTTONS): number {
  return Math.ceil((NAME_FLOOR + WIDTH.editor + WIDTH.updated + reserve + PADDING) / REM) * REM
}

/** the rung for the Open dialog's own buttons (Details and "…") */
export const PICKER_EDITOR_RUNG = pickerEditorRungFor()

/**
 * The columns at a list width in px; no (or an unusable) width means all of
 * them. `reserve` is the px the host's buttons take at the row's end.
 */
export function pickerColumnsFor(
  width?: number,
  reserve: number = PICKER_BUTTONS,
): PickerColumnId[] {
  const w = typeof width === 'number' && Number.isFinite(width) ? width : Number.POSITIVE_INFINITY
  return w >= pickerEditorRungFor(reserve) ? [...PICKER_COLUMNS] : ['name', 'updated']
}

/** Tên's floor once Người sửa is gone: it may shrink (ellipsis) so a row never runs under its buttons */
const NAME_FLOOR_TWO = 96

const TRACK: Record<PickerColumnId, string> = {
  name: `minmax(${NAME_FLOOR}px, 1fr)`,
  editor: `minmax(${WIDTH.editor - 8}px, 0.7fr)`,
  updated: `${WIDTH.updated}px`,
}

/** the grid tracks of a row and of the header above it */
export function pickerTrackOf(columns: readonly PickerColumnId[]): string {
  return columns
    .map((column) =>
      column === 'name' && !columns.includes('editor')
        ? `minmax(${NAME_FLOOR_TWO}px, 1fr)`
        : TRACK[column],
    )
    .join(' ')
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
