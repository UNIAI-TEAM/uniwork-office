import { MAX_GRID_COLUMNS, MAX_GRID_ROWS } from '@genoffice/xlsx-gateway/shared/grid-bounds'
import { IRenderManagerService } from '@univerjs/engine-render'
import { SheetSkeletonManagerService } from '@univerjs/sheets-ui'

import type { UniverRuntime, UniverWorksheet } from './univer-state'

/// Grows a worksheet's grid as the viewport approaches its edge.
///
/// The grid a sheet is created with is sized to its data (see
/// MINIMUM_SHEET_COLUMN_COUNT / MINIMUM_SHEET_ROW_COUNT in univer-sync), so a
/// blank workbook stops being scrollable a few columns past the last cell. This
/// grows it while the user works instead, the way Excel does: scrolling right
/// keeps revealing columns, because reaching the edge extends the grid before
/// the next scroll would have stopped at it.
///
/// The growth is a view concern only, so it must stay out of both histories:
/// it writes no journal entry and never reaches the snapshot, so the grid a
/// file declares on save is still the used range — the same split the engine
/// already makes for a <dimension> that runs to the last column (workbook.rs
/// declared_extent) — and it is dispatched as a mutation, so it pushes no undo
/// entry either. Scrolling is a view action: a pristine blank sheet that grew
/// past column F on a scroll must leave the Undo button disabled, or the first
/// Ctrl+Z after typing at AA1 shrinks the grid back instead of undoing the
/// edit.

/// How close the viewport's first column/row gets to the edge before the grid
/// extends. The extension is only visible once the user reaches it, so a
/// viewport parked at the edge would otherwise sit against a dead border.
const COLUMN_LOOKAHEAD = 20
const ROW_LOOKAHEAD = 200

/// How much one extension adds. A column is a fraction of a screen wide and a
/// row is a couple of lines tall, so the axes need different steps to cover the
/// same distance.
const COLUMN_STEP = 26
const ROW_STEP = 200

export interface GridEdge {
  /// first visible column and row, 0-based (Univer's own indices)
  readonly startColumn: number
  readonly startRow: number
  /// the grid's present size, in columns and rows
  readonly columnCount: number
  readonly rowCount: number
}

export interface GridGrowth {
  readonly columnCount: number
  readonly rowCount: number
}

/**
 * The grid size the viewport at `edge` needs, or null when it already has one.
 *
 * Growth is self-limiting: the caller's new size puts the viewport back outside
 * the lookahead, so a burst of scroll events extends the grid once rather than
 * once per event.
 */
export function nextGridGrowth(edge: GridEdge): GridGrowth | null {
  let columnCount = edge.columnCount
  if (columnCount < MAX_GRID_COLUMNS && edge.startColumn + COLUMN_LOOKAHEAD >= columnCount) {
    columnCount = Math.min(columnCount + COLUMN_STEP, MAX_GRID_COLUMNS)
  }
  let rowCount = edge.rowCount
  if (rowCount < MAX_GRID_ROWS && edge.startRow + ROW_LOOKAHEAD >= rowCount) {
    rowCount = Math.min(rowCount + ROW_STEP, MAX_GRID_ROWS)
  }
  if (columnCount === edge.columnCount && rowCount === edge.rowCount) return null
  return { columnCount, rowCount }
}

interface ScrollCommandParams {
  readonly sheetViewStartColumn?: number
  readonly sheetViewStartRow?: number
}

interface SkeletonLike {
  readonly scrollX: number
  getColWidth(index: number): number
}

interface SkeletonManagerLike {
  getCurrentSkeleton(): SkeletonLike | null
  reCalculate(): void
}

interface RenderUnitLike {
  with<T>(token: unknown): T
}

interface InjectorLike {
  get<T>(token: unknown): T
}

/** Univer's scroll command: the one carrying the viewport's first row/column. */
const SET_SCROLL_COMMAND = 'sheet.operation.set-scroll'
const SET_ACTIVE_SHEET_OPERATION = 'sheet.operation.set-worksheet-active'
const SET_COLUMN_COUNT_MUTATION = 'sheet.mutation.set-worksheet-column-count'
const SET_ROW_COUNT_MUTATION = 'sheet.mutation.set-worksheet-row-count'

function resolveSkeletonManager(
  runtime: UniverRuntime,
  unitId: string,
): SkeletonManagerLike | null {
  try {
    const injector = (
      runtime.univer as unknown as { __getInjector(): InjectorLike }
    ).__getInjector()
    const render = injector
      .get<{ getRenderById(id: string): RenderUnitLike | null }>(IRenderManagerService)
      .getRenderById(unitId)
    if (!render) return null
    return render.with<SkeletonManagerLike>(SheetSkeletonManagerService)
  } catch {
    return null
  }
}

/**
 * Grows `worksheet`'s grid to at least `needed` rows and columns (1-based counts,
 * clamped to MAX_GRID_ROWS / MAX_GRID_COLUMNS) using the raw count mutations so no
 * undo item is pushed, then recalculates the render skeleton when the size changed.
 */
export function growSheetToFit(
  runtime: UniverRuntime,
  worksheet: UniverWorksheet,
  needed: { readonly rowCount?: number; readonly columnCount?: number },
  skeletonManager?: SkeletonManagerLike | null,
): boolean {
  const currentColumns = worksheet.getMaxColumns()
  const currentRows = worksheet.getMaxRows()
  const nextColumns = Math.min(
    MAX_GRID_COLUMNS,
    Math.max(currentColumns, needed.columnCount ?? currentColumns),
  )
  const nextRows = Math.min(MAX_GRID_ROWS, Math.max(currentRows, needed.rowCount ?? currentRows))
  if (nextColumns === currentColumns && nextRows === currentRows) return false
  // Dispatch the mutations directly. The facade's setColumnCount/setRowCount
  // run SetWorksheetColumnCountCommand / SetWorksheetRowCountCommand, and both
  // handlers call undoRedoService.pushUndoRedo, so every growth step would
  // otherwise leave an undo step behind. The mutation handlers call
  // worksheet.setColumnCount / setRowCount and stop there, so the grid grows
  // with the undo stack untouched.
  const unitId = worksheet.getSheet().getUnitId()
  const subUnitId = worksheet.getSheetId()
  if (nextColumns !== currentColumns) {
    runtime.univerAPI.syncExecuteCommand(SET_COLUMN_COUNT_MUTATION, {
      unitId,
      subUnitId,
      columnCount: nextColumns,
    })
  }
  if (nextRows !== currentRows) {
    runtime.univerAPI.syncExecuteCommand(SET_ROW_COUNT_MUTATION, {
      unitId,
      subUnitId,
      rowCount: nextRows,
    })
  }
  // the skeleton caches the row/column sizes it was built with
  ;(skeletonManager !== undefined
    ? skeletonManager
    : resolveSkeletonManager(runtime, unitId)
  )?.reCalculate()
  return true
}
/**
 * Grows the active sheet's grid as its viewport nears the edge.
 *
 * The viewport arrives through Univer's scroll command rather than a scroll
 * service: SheetScrollManagerService is declared in @univerjs/sheets-ui but is
 * not registered in this build, so asking the injector for it throws. The
 * command is dispatched on every scroll — wheel, scrollbar, keyboard — and
 * carries sheetViewStartColumn/Row directly, so no pixel-to-index conversion
 * is needed.
 *
 * Two triggers, because neither alone covers everything:
 *   - the command subscription, which is the real signal
 *   - a slow poll, for a scroll the command path does not cover, and because
 *     the render unit only exists a moment after install
 *
 * The poll reads the viewport from the skeleton rather than the command stream,
 * so it can answer before any scroll command has arrived. Its early bail reads
 * the command stream's lastColumn to skip the width walk, which narrows the
 * poll: a scroll the command path genuinely misses now goes ungrown until a
 * later command moves lastColumn. The command fires on wheel, scrollbar and
 * keyboard alike, so that miss is rare.
 *
 * Returns a disposer.
 */
export function installGridGrowth(runtime: UniverRuntime): () => void {
  let disposed = false
  // The render unit appears after install, so resolve it per use and cache only
  // once it resolves: a cached miss would pin the growth off forever.
  let skeletonManager: SkeletonManagerLike | null = null

  const currentSkeletonManager = (): SkeletonManagerLike | null => {
    if (skeletonManager) return skeletonManager
    const workbook = runtime.univerAPI.getActiveWorkbook()
    if (!workbook) return null
    skeletonManager = resolveSkeletonManager(runtime, workbook.getId())
    return skeletonManager
  }

  const growIfNearEdge = (startColumn: number, startRow: number): void => {
    if (disposed) return
    const worksheet = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()
    if (!worksheet) return
    const growth = nextGridGrowth({
      startColumn,
      startRow,
      columnCount: worksheet.getMaxColumns(),
      rowCount: worksheet.getMaxRows(),
    })
    if (!growth) return
    growSheetToFit(runtime, worksheet, growth, currentSkeletonManager())
  }

  let lastColumn = 0
  let lastRow = 0

  /**
   * The first column the viewport shows, read from the skeleton: walk the
   * column widths until they cover the scrolled distance. Independent of the
   * command stream, so it also answers when no scroll command has arrived.
   */
  const firstVisibleColumn = (skeleton: SkeletonLike, columnCount: number): number => {
    let x = 0
    for (let i = 0; i < columnCount; i++) {
      x += skeleton.getColWidth(i)
      if (x > skeleton.scrollX) return i
    }
    return Math.max(0, columnCount - 1)
  }

  const onCommand = runtime.univerAPI.onCommandExecuted(
    (command: { id?: string; params?: unknown }) => {
      if (command?.id === SET_ACTIVE_SHEET_OPERATION) {
        // The viewport position belongs to the sheet it was scrolled on.
        lastColumn = 0
        lastRow = 0
        return
      }
      if (command?.id !== SET_SCROLL_COMMAND) return
      const params = command.params as ScrollCommandParams | undefined
      if (!params) return
      lastColumn = params.sheetViewStartColumn ?? lastColumn
      lastRow = params.sheetViewStartRow ?? lastRow
      growIfNearEdge(lastColumn, lastRow)
    },
  )

  // Backstop: a viewport move the command stream does not carry, and the
  // window between install and the render unit existing.
  const timer = window.setInterval(() => {
    if (disposed) return
    const worksheet = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()
    const manager = currentSkeletonManager()
    if (!worksheet || !manager) return
    const skeleton = manager.getCurrentSkeleton()
    if (!skeleton) return
    const columnCount = worksheet.getMaxColumns()
    // Walking the widths costs one getColWidth per column, and this runs four
    // times a second, so return while the last scroll command put the viewport
    // well inside the grid: the walk could only confirm there is nothing to
    // grow. This trades backstop coverage for the walk — see the note above.
    if (lastColumn + COLUMN_LOOKAHEAD < columnCount) return
    const walked = firstVisibleColumn(skeleton, columnCount)
    growIfNearEdge(walked, lastRow)
  }, 250)

  return () => {
    disposed = true
    window.clearInterval(timer)
    onCommand?.dispose?.()
  }
}
