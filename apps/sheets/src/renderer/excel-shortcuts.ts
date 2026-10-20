/**
 * Excel-standard shortcuts Univer doesn't ship, bound from the sheets shortcut
 * table (`@genoffice/shortcuts`, UNI-2011): every chord comes from a table row,
 * per platform and surface, converted to Univer's keyCode bindings
 * (sheets-keymap.ts). The dispatcher itself gets the IME / AltGr guard.
 *
 * Univer's KeyCode enum stops at SPACE/arrows — Home, End, PageUp and
 * PageDown don't even have names, so nothing upstream can bind them. The
 * shortcut dispatcher matches on the raw browser keyCode, so registering
 * with the numeric codes works. Everything here reuses the
 * whenSheetEditorFocused precondition: with the cell editor or formula bar
 * active these keys keep their text-editing meaning.
 *
 * - next / previous visible worksheet tab (sheets-39, sheets-40)
 * - Ctrl+Home: first unfrozen cell (A1 without frozen panes); Ctrl+End: last
 *   used cell (content or formatting, like Excel); with Shift the selection
 *   grows to them (sheets-33..35)
 * - Home: start of the current row (first unfrozen column)
 * - select the whole column / row / all / current region (sheets-24..27)
 * - hide / unhide the rows or columns the selection spans (sheets-22, -23)
 * - insert / delete cells: whole rows/columns act directly, otherwise the
 *   dialog opens (sheets-19, -20)
 * - Excel for Mac's extra keys next to Univer's own: fill down / right with
 *   Control, ⌘Enter fills the selection like ⌃Enter, ⌃⌥Enter / ⌘⌥Enter break
 *   the line like ⌥Enter, ⌘T cycles the reference like F4, ⌘= recalculates
 */
import {
  CommandType,
  EDITOR_ACTIVATED,
  FOCUSING_EDITOR_INPUT_FORMULA,
  FOCUSING_EDITOR_STANDALONE,
  FOCUSING_SHEET,
  FOCUSING_UNIVER_EDITOR,
  ICommandService,
  IUniverInstanceService,
  RANGE_TYPE,
  Rectangle,
} from '@univerjs/core'
import type { IAccessor, ICommand, IRange, Worksheet } from '@univerjs/core'
import { IShortcutService, KeyCode, MetaKeys } from '@univerjs/ui'
import type { IShortcutItem } from '@univerjs/ui'
import {
  SelectionMoveType,
  SetColHiddenCommand,
  SetRowHiddenCommand,
  SetSelectionsOperation,
  SetSpecificColsVisibleCommand,
  SetSpecificRowsVisibleCommand,
  SetWorksheetActivateCommand,
  SheetCopyDownCommand,
  SheetCopyRightCommand,
  SheetsSelectionsService,
  getCellAtRowCol,
  getSheetCommandTarget,
} from '@univerjs/sheets'
import {
  SelectAllCommand,
  SetCellEditVisibleOperation,
  whenSheetEditorActivated,
  whenSheetEditorFocused,
} from '@univerjs/sheets-ui'
import { BreakLineCommand } from '@univerjs/docs-ui'
import { ReferenceAbsoluteOperation } from '@univerjs/sheets-formula-ui'
import { DeviceInputEventType } from '@univerjs/engine-render'
import type { IContextService } from '@univerjs/core'
import {
  chordsFor,
  parseChord,
  type Chord,
  type ParsedChord,
  type ShortcutPlatform,
} from '@genoffice/shortcuts'
import { sheetsShortcut } from '../shared/sheets-shortcuts'
import type { UniverRuntime } from './univer-state'
import { requestCellsAction } from './insert-delete-cells'
import type { CellsMode } from './insert-delete-cells'
import {
  chordToUniverBinding,
  guardUniverDispatch,
  isSecondSubAction,
  sheetsKeyTarget,
  type SheetsKeyTarget,
} from './sheets-keymap'

// browser keycodes Univer's KeyCode enum doesn't name
const KEY_HOME = 36
const KEY_NUMPAD_ADD = 107
const KEY_NUMPAD_SUBTRACT = 109

const ACTIVATE_ADJACENT_SHEET_ID = 'genoffice.command.activate-adjacent-sheet'
const SELECT_SHEET_HOME_ID = 'genoffice.command.select-sheet-home'
const SELECT_SHEET_END_ID = 'genoffice.command.select-sheet-end'
const SELECT_ROW_HOME_ID = 'genoffice.command.select-row-home'
const SELECT_WHOLE_COLUMN_ID = 'genoffice.command.select-whole-column'
const SELECT_WHOLE_ROW_ID = 'genoffice.command.select-whole-row'
const HIDE_SELECTED_ROWS_ID = 'genoffice.command.hide-selected-rows'
const UNHIDE_SELECTED_ROWS_ID = 'genoffice.command.unhide-selected-rows'
const HIDE_SELECTED_COLS_ID = 'genoffice.command.hide-selected-cols'
const UNHIDE_SELECTED_COLS_ID = 'genoffice.command.unhide-selected-cols'
const INSERT_CELLS_ID = 'genoffice.command.insert-cells'
const DELETE_CELLS_ID = 'genoffice.command.delete-cells'
const EXTEND_TO_SHEET_HOME_ID = 'genoffice.command.extend-selection-sheet-home'
const EXTEND_TO_SHEET_END_ID = 'genoffice.command.extend-selection-sheet-end'
const RUN_APP_COMMAND_ID = 'genoffice.command.run-app-command'
const RELEASED_SHORTCUT_ID = 'genoffice.command.released-shortcut'

/** first visible line at or after `from` (hidden rows/columns are not landing spots) */
function firstVisible(worksheet: Worksheet, axis: 'row' | 'column', from: number): number {
  const count = axis === 'row' ? worksheet.getRowCount() : worksheet.getColumnCount()
  for (let index = from; index < count; index += 1) {
    const visible = axis === 'row' ? worksheet.getRowVisible(index) : worksheet.getColVisible(index)
    if (visible) return index
  }
  return from
}

/** first visible cell outside the frozen panes (Excel's Ctrl+Home target) */
function unfrozenOrigin(worksheet: Worksheet): { row: number; column: number } {
  const freeze = worksheet.getConfig().freeze
  const row = freeze && freeze.ySplit > 0 && freeze.startRow > 0 ? freeze.startRow : 0
  const column = freeze && freeze.xSplit > 0 && freeze.startColumn > 0 ? freeze.startColumn : 0
  return {
    row: firstVisible(worksheet, 'row', row),
    column: firstVisible(worksheet, 'column', column),
  }
}

function selectCell(accessor: IAccessor, row: number, column: number): Promise<boolean> {
  const target = getSheetCommandTarget(accessor.get(IUniverInstanceService))
  if (!target) return Promise.resolve(false)
  const { workbook, worksheet } = target
  const destRange = getCellAtRowCol(row, column, worksheet)
  return accessor.get(ICommandService).executeCommand(SetSelectionsOperation.id, {
    unitId: workbook.getUnitId(),
    subUnitId: worksheet.getSheetId(),
    selections: [
      {
        range: Rectangle.clone(destRange),
        primary: {
          startRow: destRange.startRow,
          startColumn: destRange.startColumn,
          endRow: destRange.endRow,
          endColumn: destRange.endColumn,
          actualRow: row,
          actualColumn: column,
          isMerged: destRange.isMerged,
          isMergedMainCell: destRange.startRow === row && destRange.startColumn === column,
        },
      },
    ],
    type: SelectionMoveType.MOVE_END,
    reveal: true,
  })
}

/** A Univer registration of a sheets table row (`shortcuts.csv` id). */
interface TableShortcut {
  readonly row: string
  readonly item: Omit<IShortcutItem, 'binding' | 'mac' | 'win' | 'linux'>
  /** the chords of a two-sub-action row that belong to this item */
  readonly chords?: (chord: ParsedChord) => boolean
  /** chords Univer itself already binds to this command (its own item stays) */
  readonly univerOwns?: Readonly<Record<ShortcutPlatform, readonly Chord[]>>
}

/**
 * Univer defaults the table drops, claimed as no-ops: Shift+Cmd+L toggles the
 * filter upstream, but in Excel for Mac it opens Modify Cell Style (sheets-81).
 */
const RELEASED_UNIVER_CHORDS: Readonly<Record<ShortcutPlatform, readonly Chord[]>> = {
  win: [],
  mac: ['Shift+Cmd+L'],
}

/**
 * `usedEndOf` supplies the file's last used cell for a sheet id (sidecar
 * dimensions) — on streamed workbooks Univer's cell matrix only holds the
 * loaded window, so Ctrl+End takes whichever reaches further per axis.
 * `onAppCommand` runs a ribbon command for a table chord Univer binds to
 * something else (Excel for Mac's Cmd+= recalculates).
 */
export function registerExcelShortcuts(
  runtime: UniverRuntime,
  usedEndOf?: (subUnitId: string) => { row: number; column: number } | null,
  openCellsDialog: (mode: CellsMode) => void = () => {},
  onAppCommand: (command: string) => void = () => {},
  keys: SheetsKeyTarget = sheetsKeyTarget(),
): void {
  const injector = runtime.univer.__getInjector()
  const commandService = injector.get(ICommandService)
  const shortcutService = injector.get(IShortcutService)

  const activateAdjacentSheet: ICommand<{ step: number }> = {
    id: ACTIVATE_ADJACENT_SHEET_ID,
    type: CommandType.COMMAND,
    handler: (accessor, params) => {
      if (!params) return false
      const target = getSheetCommandTarget(accessor.get(IUniverInstanceService))
      if (!target) return false
      const { workbook } = target
      const visible = workbook.getSheets().filter((sheet) => sheet.getConfig().hidden !== 1)
      const activeId = workbook.getActiveSheet()?.getSheetId()
      const index = visible.findIndex((sheet) => sheet.getSheetId() === activeId)
      if (index < 0) return false
      const next = visible[index + params.step]
      if (!next) return false // Excel doesn't wrap at either end
      // SetWorksheetActivateCommand's handler is async — syncExecuteCommand
      // throws on promise-returning handlers. Await it instead; real key
      // repeats flush microtasks between events, so the next press reads the
      // fresh active sheet.
      return accessor.get(ICommandService).executeCommand(SetWorksheetActivateCommand.id, {
        unitId: workbook.getUnitId(),
        subUnitId: next.getSheetId(),
      })
    },
  }

  const selectSheetHome: ICommand = {
    id: SELECT_SHEET_HOME_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => {
      const target = getSheetCommandTarget(accessor.get(IUniverInstanceService))
      if (!target) return false
      const origin = unfrozenOrigin(target.worksheet)
      return selectCell(accessor, origin.row, origin.column)
    },
  }

  /** the last used cell (Ctrl+End target); A1 on an empty sheet */
  const usedEnd = (worksheet: Worksheet): { row: number; column: number } => {
    const matrix = worksheet.getCellMatrix()
    const loaded = matrix.getLength() === 0 ? null : matrix.getDataRange()
    const fileEnd = usedEndOf?.(worksheet.getSheetId()) ?? null
    return {
      row: Math.max(loaded?.endRow ?? 0, fileEnd?.row ?? 0, 0),
      column: Math.max(loaded?.endColumn ?? 0, fileEnd?.column ?? 0, 0),
    }
  }

  const selectSheetEnd: ICommand = {
    id: SELECT_SHEET_END_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => {
      const target = getSheetCommandTarget(accessor.get(IUniverInstanceService))
      if (!target) return false
      const end = usedEnd(target.worksheet)
      return selectCell(accessor, end.row, end.column)
    },
  }

  const selectRowHome: ICommand = {
    id: SELECT_ROW_HOME_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => {
      const target = getSheetCommandTarget(accessor.get(IUniverInstanceService))
      if (!target) return false
      const selection = accessor.get(SheetsSelectionsService).getCurrentLastSelection()
      if (!selection) return false
      const row = selection.primary?.actualRow ?? selection.range.startRow
      return selectCell(accessor, row, unfrozenOrigin(target.worksheet).column)
    },
  }

  const wholeRange = (accessor: IAccessor, kind: 'row' | 'column'): Promise<boolean> => {
    const target = getSheetCommandTarget(accessor.get(IUniverInstanceService))
    if (!target) return Promise.resolve(false)
    const { workbook, worksheet } = target
    const selection = accessor.get(SheetsSelectionsService).getCurrentLastSelection()
    if (!selection) return Promise.resolve(false)
    const { range, primary } = selection
    const destRange: IRange =
      kind === 'column'
        ? {
            startRow: 0,
            endRow: worksheet.getRowCount() - 1,
            startColumn: range.startColumn,
            endColumn: range.endColumn,
            rangeType: RANGE_TYPE.COLUMN,
          }
        : {
            startRow: range.startRow,
            endRow: range.endRow,
            startColumn: 0,
            endColumn: worksheet.getColumnCount() - 1,
            rangeType: RANGE_TYPE.ROW,
          }
    return accessor.get(ICommandService).executeCommand(SetSelectionsOperation.id, {
      unitId: workbook.getUnitId(),
      subUnitId: worksheet.getSheetId(),
      selections: [{ range: destRange, primary }],
      type: SelectionMoveType.MOVE_END,
    })
  }

  const selectWholeColumn: ICommand = {
    id: SELECT_WHOLE_COLUMN_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => wholeRange(accessor, 'column'),
  }
  const selectWholeRow: ICommand = {
    id: SELECT_WHOLE_ROW_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => wholeRange(accessor, 'row'),
  }

  /**
   * Excel's Ctrl+9/0 hides the rows/columns SPANNED by any selection —
   * Univer's own commands only act on header (ROW/COLUMN-type) selections,
   * so these wrappers convert the span and pass explicit ranges.
   */
  const axisRangeOf = (accessor: IAccessor, kind: 'row' | 'column'): IRange | null => {
    const target = getSheetCommandTarget(accessor.get(IUniverInstanceService))
    if (!target) return null
    const selection = accessor.get(SheetsSelectionsService).getCurrentLastSelection()
    if (!selection) return null
    const { range } = selection
    const { worksheet } = target
    return kind === 'row'
      ? {
          startRow: range.startRow,
          endRow: range.endRow,
          startColumn: 0,
          endColumn: worksheet.getColumnCount() - 1,
          rangeType: RANGE_TYPE.ROW,
        }
      : {
          startRow: 0,
          endRow: worksheet.getRowCount() - 1,
          startColumn: range.startColumn,
          endColumn: range.endColumn,
          rangeType: RANGE_TYPE.COLUMN,
        }
  }

  const hideOrUnhide = (
    accessor: IAccessor,
    kind: 'row' | 'column',
    action: 'hide' | 'unhide',
  ): Promise<boolean> => {
    const target = getSheetCommandTarget(accessor.get(IUniverInstanceService))
    const axisRange = axisRangeOf(accessor, kind)
    if (!target || !axisRange) return Promise.resolve(false)
    const { workbook, worksheet } = target
    if (action === 'hide') {
      // Excel refuses to hide every row/column; skip the whole-axis case
      const full =
        kind === 'row'
          ? axisRange.startRow === 0 && axisRange.endRow >= worksheet.getRowCount() - 1
          : axisRange.startColumn === 0 && axisRange.endColumn >= worksheet.getColumnCount() - 1
      if (full) return Promise.resolve(false)
    }
    const commandId =
      kind === 'row'
        ? action === 'hide'
          ? SetRowHiddenCommand.id
          : SetSpecificRowsVisibleCommand.id
        : action === 'hide'
          ? SetColHiddenCommand.id
          : SetSpecificColsVisibleCommand.id
    return accessor.get(ICommandService).executeCommand(commandId, {
      unitId: workbook.getUnitId(),
      subUnitId: worksheet.getSheetId(),
      ranges: [axisRange],
    })
  }

  const hideSelectedRows: ICommand = {
    id: HIDE_SELECTED_ROWS_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => hideOrUnhide(accessor, 'row', 'hide'),
  }
  const unhideSelectedRows: ICommand = {
    id: UNHIDE_SELECTED_ROWS_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => hideOrUnhide(accessor, 'row', 'unhide'),
  }
  const hideSelectedCols: ICommand = {
    id: HIDE_SELECTED_COLS_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => hideOrUnhide(accessor, 'column', 'hide'),
  }
  const unhideSelectedCols: ICommand = {
    id: UNHIDE_SELECTED_COLS_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => hideOrUnhide(accessor, 'column', 'unhide'),
  }

  const insertCells: ICommand = {
    id: INSERT_CELLS_ID,
    type: CommandType.COMMAND,
    handler: () => requestCellsAction(runtime, 'insert', openCellsDialog),
  }
  const deleteCells: ICommand = {
    id: DELETE_CELLS_ID,
    type: CommandType.COMMAND,
    handler: () => requestCellsAction(runtime, 'delete', openCellsDialog),
  }

  // Ctrl+Shift+Home / End: grow the selection from the active cell to the
  // Ctrl+Home / Ctrl+End target, the active cell staying where it is
  const extendSelectionTo = (
    accessor: IAccessor,
    to: (worksheet: Worksheet) => { row: number; column: number },
  ): Promise<boolean> => {
    const target = getSheetCommandTarget(accessor.get(IUniverInstanceService))
    if (!target) return Promise.resolve(false)
    const selection = accessor.get(SheetsSelectionsService).getCurrentLastSelection()
    if (!selection) return Promise.resolve(false)
    const { workbook, worksheet } = target
    const { range, primary } = selection
    const anchorRow = primary?.actualRow ?? range.startRow
    const anchorColumn = primary?.actualColumn ?? range.startColumn
    const dest = to(worksheet)
    return accessor.get(ICommandService).executeCommand(SetSelectionsOperation.id, {
      unitId: workbook.getUnitId(),
      subUnitId: worksheet.getSheetId(),
      selections: [
        {
          range: {
            startRow: Math.min(anchorRow, dest.row),
            endRow: Math.max(anchorRow, dest.row),
            startColumn: Math.min(anchorColumn, dest.column),
            endColumn: Math.max(anchorColumn, dest.column),
            rangeType: RANGE_TYPE.NORMAL,
          },
          primary,
        },
      ],
      type: SelectionMoveType.MOVE_END,
      reveal: true,
    })
  }

  const extendToSheetHome: ICommand = {
    id: EXTEND_TO_SHEET_HOME_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => extendSelectionTo(accessor, unfrozenOrigin),
  }
  const extendToSheetEnd: ICommand = {
    id: EXTEND_TO_SHEET_END_ID,
    type: CommandType.COMMAND,
    handler: (accessor) => extendSelectionTo(accessor, usedEnd),
  }

  // a table chord Univer binds to something else: hand it to the app's command
  const runAppCommand: ICommand<{ command: string }> = {
    id: RUN_APP_COMMAND_ID,
    type: CommandType.COMMAND,
    handler: (_accessor, params) => {
      if (!params) return false
      onAppCommand(params.command)
      return true
    },
  }
  // a Univer default the table drops: claimed so it does nothing
  const releasedShortcut: ICommand = {
    id: RELEASED_SHORTCUT_ID,
    type: CommandType.COMMAND,
    handler: () => true,
  }

  for (const command of [
    activateAdjacentSheet,
    selectSheetHome,
    selectSheetEnd,
    selectRowHome,
    selectWholeColumn,
    selectWholeRow,
    hideSelectedRows,
    unhideSelectedRows,
    hideSelectedCols,
    unhideSelectedCols,
    insertCells,
    deleteCells,
    extendToSheetHome,
    extendToSheetEnd,
    runAppCommand,
    releasedShortcut,
  ]) {
    commandService.registerCommand(command)
  }

  guardUniverDispatch(shortcutService, keys.platform)

  const first = (row: string) => (chord: ParsedChord) => !isSecondSubAction(row, chord)
  const second = (row: string) => (chord: ParsedChord) => isSecondSubAction(row, chord)
  const sheetFocused = { preconditions: whenSheetEditorFocused }
  // Excel semantics outrank Univer's own items on these keys: Ctrl+9 / Ctrl+Shift+0
  // are header-selection-only hides upstream, Ctrl+0 / Ctrl+- / Cmd+= zoom
  const overrides = { preconditions: whenSheetEditorFocused, priority: 100 }

  const tableShortcuts: readonly TableShortcut[] = [
    {
      row: 'sheets-39',
      item: { id: ACTIVATE_ADJACENT_SHEET_ID, ...sheetFocused, staticParameters: { step: 1 } },
    },
    {
      row: 'sheets-40',
      item: { id: ACTIVATE_ADJACENT_SHEET_ID, ...sheetFocused, staticParameters: { step: -1 } },
    },
    { row: 'sheets-34', item: { id: SELECT_SHEET_HOME_ID, ...sheetFocused } },
    { row: 'sheets-35', item: { id: SELECT_SHEET_END_ID, ...sheetFocused } },
    {
      row: 'sheets-33',
      item: { id: EXTEND_TO_SHEET_HOME_ID, ...sheetFocused },
      chords: first('sheets-33'),
    },
    {
      row: 'sheets-33',
      item: { id: EXTEND_TO_SHEET_END_ID, ...sheetFocused },
      chords: second('sheets-33'),
    },
    // Excel for Mac selects with the real Control key too (⌘Space is Spotlight)
    { row: 'sheets-24', item: { id: SELECT_WHOLE_COLUMN_ID, ...sheetFocused } },
    { row: 'sheets-25', item: { id: SELECT_WHOLE_ROW_ID, ...sheetFocused } },
    {
      row: 'sheets-26',
      item: {
        id: SelectAllCommand.id,
        ...sheetFocused,
        staticParameters: { expandToGapFirst: true, loop: true },
      },
      univerOwns: { win: ['Ctrl+A'], mac: ['Cmd+A'] },
    },
    {
      row: 'sheets-27',
      item: {
        id: SelectAllCommand.id,
        ...sheetFocused,
        staticParameters: { expandToGapFirst: true, loop: false },
      },
    },
    // Excel's hide / unhide act on the rows / columns any selection spans
    {
      row: 'sheets-22',
      item: { id: HIDE_SELECTED_ROWS_ID, ...overrides },
      chords: first('sheets-22'),
    },
    {
      row: 'sheets-22',
      item: { id: UNHIDE_SELECTED_ROWS_ID, ...overrides },
      chords: second('sheets-22'),
    },
    {
      row: 'sheets-23',
      item: { id: HIDE_SELECTED_COLS_ID, ...overrides },
      chords: first('sheets-23'),
    },
    {
      row: 'sheets-23',
      item: { id: UNHIDE_SELECTED_COLS_ID, ...overrides },
      chords: second('sheets-23'),
    },
    // Insert / Delete Cells: whole rows / columns act directly, otherwise the dialog opens
    { row: 'sheets-19', item: { id: INSERT_CELLS_ID, ...overrides } },
    { row: 'sheets-20', item: { id: DELETE_CELLS_ID, ...overrides } },
    {
      row: 'sheets-17',
      item: { id: SheetCopyDownCommand.id, ...sheetFocused },
      univerOwns: { win: ['Ctrl+D'], mac: ['Cmd+D'] },
    },
    {
      row: 'sheets-18',
      item: { id: SheetCopyRightCommand.id, ...sheetFocused },
      univerOwns: { win: ['Ctrl+R'], mac: ['Cmd+R'] },
    },
    {
      row: 'sheets-15',
      item: { id: BreakLineCommand.id, preconditions: whenSheetEditorActivated },
      univerOwns: { win: ['Alt+Enter'], mac: ['Alt+Enter'] },
    },
    // Upstream's ⌃Enter precondition (whenEditorDidNotInputFormulaActivated)
    // is not exported; same context checks.
    {
      row: 'sheets-16',
      item: {
        id: SetCellEditVisibleOperation.id,
        preconditions: whenCellEditorNotFormulaActivated,
        staticParameters: {
          visible: false,
          eventType: DeviceInputEventType.Keyboard,
          keycode: KeyCode.ENTER | MetaKeys.CTRL_COMMAND,
        },
      },
      univerOwns: { win: ['Ctrl+Enter'], mac: ['Ctrl+Enter'] },
    },
    {
      row: 'sheets-47',
      item: { id: ReferenceAbsoluteOperation.id, preconditions: whenSheetEditorActivated },
      univerOwns: { win: ['F4'], mac: ['F4'] },
    },
    // Excel for Mac's Cmd+= is Calculate Now, which Univer binds to zoom in
    {
      row: 'sheets-53',
      item: {
        id: RUN_APP_COMMAND_ID,
        ...overrides,
        staticParameters: { command: 'calculate-now' },
      },
      chords: (chord) => chord.key === 'Equal',
    },
  ]
  for (const entry of tableShortcuts) {
    for (const item of tableShortcutItems(entry, keys)) shortcutService.registerShortcut(item)
  }
  for (const chord of RELEASED_UNIVER_CHORDS[keys.platform]) {
    const binding = chordToUniverBinding(chord, keys.platform)
    if (binding !== null) {
      shortcutService.registerShortcut({ id: RELEASED_SHORTCUT_ID, binding, ...overrides })
    }
  }

  // Keys the table cannot hold: a bare Home (sheets-36; the table's chord check
  // reads modified keys and F-keys only) and the numeric keypad's + / - next
  // to Ctrl+Shift+= / Ctrl+- (sheets-19, sheets-20; chords name main-row keys)
  const items: IShortcutItem[] = [
    { id: SELECT_ROW_HOME_ID, binding: KEY_HOME, ...sheetFocused },
    { id: INSERT_CELLS_ID, binding: KEY_NUMPAD_ADD | MetaKeys.CTRL_COMMAND, ...overrides },
    { id: DELETE_CELLS_ID, binding: KEY_NUMPAD_SUBTRACT | MetaKeys.CTRL_COMMAND, ...overrides },
  ]
  for (const item of items) shortcutService.registerShortcut(item)
}

/** One Univer item per table chord of a row on this platform and surface. */
function tableShortcutItems(entry: TableShortcut, keys: SheetsKeyTarget): IShortcutItem[] {
  const owned = entry.univerOwns?.[keys.platform] ?? []
  const items: IShortcutItem[] = []
  for (const chord of chordsFor(sheetsShortcut(entry.row), keys.platform, keys.surface)) {
    const parsed = parseChord(chord)
    if (!parsed || owned.includes(chord) || (entry.chords && !entry.chords(parsed))) continue
    const binding = chordToUniverBinding(chord, keys.platform)
    if (binding !== null) items.push({ ...entry.item, binding })
  }
  return items
}

function whenCellEditorNotFormulaActivated(contextService: IContextService): boolean {
  return (
    contextService.getContextValue(FOCUSING_SHEET) &&
    contextService.getContextValue(FOCUSING_UNIVER_EDITOR) &&
    contextService.getContextValue(EDITOR_ACTIVATED) &&
    !contextService.getContextValue(FOCUSING_EDITOR_INPUT_FORMULA) &&
    !contextService.getContextValue(FOCUSING_EDITOR_STANDALONE)
  )
}

/** exported for tests */
export const _shortcutInternals = {
  ACTIVATE_ADJACENT_SHEET_ID,
  SELECT_SHEET_HOME_ID,
  SELECT_SHEET_END_ID,
  SELECT_ROW_HOME_ID,
  SELECT_WHOLE_COLUMN_ID,
  SELECT_WHOLE_ROW_ID,
  HIDE_SELECTED_ROWS_ID,
  UNHIDE_SELECTED_ROWS_ID,
  HIDE_SELECTED_COLS_ID,
  UNHIDE_SELECTED_COLS_ID,
  KEY_HOME,
  KEY_NUMPAD_ADD,
  KEY_NUMPAD_SUBTRACT,
  INSERT_CELLS_ID,
  DELETE_CELLS_ID,
  EXTEND_TO_SHEET_HOME_ID,
  EXTEND_TO_SHEET_END_ID,
  RUN_APP_COMMAND_ID,
  RELEASED_SHORTCUT_ID,
  unfrozenOrigin,
}
