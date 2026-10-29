import {
  replaceInRichDoc,
  replaceSuggestion,
  type RichDoc,
  type SpellCellRef,
  type SpellFinding,
  type SpellSnapshot,
} from './spell-check'

/**
 * Structural slice of Univer's FWorkbook/FWorksheet the dialog needs; keeps
 * the component off the full facade types and the write path unit-testable.
 */
export interface SpellWorkbookLike {
  getSheets(): { getSheetId(): string; getSheetName(): string }[] | null
  getSnapshot(): unknown
  getSheetBySheetId(sheetId: string): SpellWorksheetLike | null
}

export interface SpellWorksheetLike {
  getRange(row: number, column: number): object
}

/** The live snapshot cell, as the replacement's starting point. */
function liveCell(
  snapshot: SpellSnapshot,
  sheetId: string,
  row: number,
  column: number,
): SpellCellRef | null {
  const cell = snapshot.sheets[sheetId]?.cellData?.[String(row)]?.[String(column)]
  if (!cell || typeof cell.v !== 'string') return null
  return { sheetId, sheetName: '', address: '', row, column, text: cell.v }
}

/**
 * Writes one replacement into a cell, against its CURRENT value — the user
 * may have edited it since the scan — through Univer so undo, journal and
 * dirty state all see it. A rich-text cell (cell.p) keeps its runs: the
 * replacement rewrites the document's dataStream and shifts the runs, the
 * shape Excel's own in-cell corrector leaves behind.
 *
 * Returns whether the live cell really holds the corrected text afterwards:
 * the protection / view-only guards veto a write by cancelling the command,
 * and Univer's facade reports nothing then, so the cell is read back.
 */
export function applySpellReplacement(
  workbook: SpellWorkbookLike | null,
  finding: SpellFinding,
  suggestion: string,
): boolean {
  const { sheetId, row, column } = finding.cell
  const worksheet = workbook?.getSheetBySheetId(sheetId)
  if (!workbook || !worksheet) return false
  const snapshot = workbook.getSnapshot() as SpellSnapshot
  const live = liveCell(snapshot, sheetId, row, column)
  if (live === null) return false
  const next = replaceSuggestion(live.text, finding.word, suggestion)
  if (next === live.text) return false
  const rich = (
    snapshot.sheets[sheetId]?.cellData?.[String(row)]?.[String(column)] as
      { p?: RichDoc | null } | undefined
  )?.p
  let doc: RichDoc | null = null
  if (rich !== undefined && rich !== null) {
    doc = replaceInRichDoc(rich, finding.word, suggestion)
    if (doc === null) return false
  }
  // setValues takes the exact cell object (no formula / number / date
  // re-parse of the new text, unlike setValue); p carries a rich document
  // the cast only erases the facade's branded matrix types
  const range = worksheet.getRange(row, column) as {
    setValues(values: { v: string; p: RichDoc | null; f: null }[][]): unknown
  }
  range.setValues([[{ v: next, p: doc, f: null }]])
  const after = liveCell(workbook.getSnapshot() as SpellSnapshot, sheetId, row, column)
  return after !== null && after.text === next
}
