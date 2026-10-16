import {
  formatAddress,
  parseAddress,
  parseRange,
} from '@genoffice/xlsx-gateway/domain/cell-address'
import {
  copyTargetBounds,
  type WorkbookOperation,
} from '@genoffice/xlsx-gateway/domain/workbook-dsl'
import type { TFunc } from '../i18n/locale'
import type { AiChatMessage } from './AiChatPanel'
import type { CellState, ChangePlan } from '@genoffice/xlsx-gateway/domain/workbook.types'

/**
 * Where an AI run wrote and how much existing data it replaced (G6-09 W6): the panel shows this on
 * the run's message before the user saves. Aggregated per RUN across its tools, so the numbers
 * describe the whole run, not the last batch.
 */

/** one cell a plan writes; `overwrote` = it held data before and the write changes it */
export interface WrittenCell {
  readonly sheet: string
  readonly row: number
  readonly column: number
  readonly overwrote: boolean
}

/** the writes of one applied plan, in sheet NAMES (ids mean nothing to the user) */
export interface PlanWrite {
  /** the sheet that was active when the plan applied: its ranges are shown without a sheet name */
  readonly activeSheet: string
  readonly cells: readonly WrittenCell[]
  /** fill_range / copy_range targets: range-level writes with no per-cell plan entries */
  readonly bulkRanges: readonly { readonly sheet: string; readonly range: string }[]
}

export interface ApplyFootprint {
  /** A1 ranges the run wrote, `'Sheet name'!A1:B3` for sheets other than the active one */
  readonly ranges: readonly string[]
  /** cells that held data before the run and were changed by it (formulas count) */
  readonly overwritten: number
  /** false when a bulk fill/copy ran: its overwritten cells are not counted, so `overwritten` is a lower bound */
  readonly overwrittenExact: boolean
}

interface SheetLookup {
  readonly sheetId: string
  readonly sheetName: string
  readonly sheets: readonly { readonly id: string; readonly name: string }[]
}

const hasData = (cell: CellState): boolean =>
  Boolean(cell.formula) || (cell.value !== null && cell.value !== undefined && cell.value !== '')

const changes = (before: CellState, after: CellState): boolean =>
  before.value !== after.value || (before.formula ?? '') !== (after.formula ?? '')

export function planWrite(
  plan: ChangePlan,
  operations: readonly WorkbookOperation[],
  info: SheetLookup,
): PlanWrite {
  const names = new Map(info.sheets.map((sheet) => [sheet.id, sheet.name]))
  const nameOf = (sheetId: string): string => names.get(sheetId) ?? sheetId
  const cells = plan.cellChanges.map((change): WrittenCell => {
    const { row, column } = parseAddress(change.address)
    return {
      sheet: nameOf(change.sheetId),
      row,
      column,
      overwrote: hasData(change.before) && changes(change.before, change.after),
    }
  })
  const bulkRanges: { sheet: string; range: string }[] = []
  for (const op of operations) {
    if (op.op !== 'fill_range' && op.op !== 'copy_range') continue
    const bounds = op.op === 'fill_range' ? parseRange(op.target) : copyTargetBounds(op)
    bulkRanges.push({ sheet: nameOf(op.sheetId), range: boundsLabel(bounds) })
  }
  return { activeSheet: info.sheetName, cells, bulkRanges }
}

interface Rect {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}

const boundsLabel = (b: Rect): string => {
  const first = formatAddress(b.startRow, b.startColumn)
  const last = formatAddress(b.endRow, b.endColumn)
  return first === last ? first : `${first}:${last}`
}

/** column-run per row, then equal runs in consecutive rows stacked into rectangles */
function rectsOf(keys: ReadonlySet<number>, columns: number): Rect[] {
  const rows = new Map<number, number[]>()
  for (const key of [...keys].sort((a, b) => a - b)) {
    const row = Math.floor(key / columns)
    const list = rows.get(row) ?? []
    list.push(key % columns)
    rows.set(row, list)
  }
  const open = new Map<string, Rect>()
  const done: Rect[] = []
  let previousRow = -2
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const spans: [number, number][] = []
    for (const column of rows.get(row)!) {
      const last = spans.at(-1)
      if (last && last[1] === column - 1) last[1] = column
      else spans.push([column, column])
    }
    const next = new Map<string, Rect>()
    for (const [start, end] of spans) {
      const id = `${start}:${end}`
      const rect = row === previousRow + 1 ? open.get(id) : undefined
      if (rect) {
        rect.endRow = row
        next.set(id, rect)
        open.delete(id)
      } else {
        next.set(id, { startRow: row, endRow: row, startColumn: start, endColumn: end })
      }
    }
    done.push(...open.values())
    open.clear()
    for (const [id, rect] of next) open.set(id, rect)
    previousRow = row
  }
  done.push(...open.values())
  return done.sort((a, b) => a.startRow - b.startRow || a.startColumn - b.startColumn)
}

/** sheet names that are plain identifiers go bare; everything else is quoted like Excel does */
const sheetPrefix = (sheet: string): string =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(sheet) ? `${sheet}!` : `'${sheet.replaceAll("'", "''")}'!`

/** max column count of the grid, so row*columns+column is a collision-free key */
const KEY_COLUMNS = 16_384

export interface RunWriteLedger {
  /** fold one applied plan into the run and return the run's footprint so far */
  record(write: PlanWrite): ApplyFootprint
  /** a new run starts */
  reset(): void
}

export function createRunWriteLedger(): RunWriteLedger {
  let activeSheet: string | null = null
  let sheetOrder: string[] = []
  let written = new Map<string, Set<number>>()
  let bulk = new Map<string, string[]>()
  let overwritten = 0
  let exact = true

  const touch = (sheet: string): void => {
    if (!sheetOrder.includes(sheet)) sheetOrder.push(sheet)
  }

  const snapshot = (): ApplyFootprint => {
    const ranges: string[] = []
    for (const sheet of sheetOrder) {
      const prefix = sheet === activeSheet ? '' : sheetPrefix(sheet)
      const own = rectsOf(written.get(sheet) ?? new Set(), KEY_COLUMNS).map(boundsLabel)
      for (const range of [...own, ...(bulk.get(sheet) ?? [])]) {
        const label = `${prefix}${range}`
        if (!ranges.includes(label)) ranges.push(label)
      }
    }
    return { ranges, overwritten, overwrittenExact: exact }
  }

  return {
    record(write) {
      activeSheet ??= write.activeSheet
      for (const cell of write.cells) {
        touch(cell.sheet)
        const keys = written.get(cell.sheet) ?? new Set<number>()
        written.set(cell.sheet, keys)
        const key = cell.row * KEY_COLUMNS + cell.column
        // a cell the run already wrote is its own data now: only its first touch can overwrite the user's
        if (keys.has(key)) continue
        keys.add(key)
        if (cell.overwrote) overwritten += 1
      }
      for (const { sheet, range } of write.bulkRanges) {
        touch(sheet)
        const list = bulk.get(sheet) ?? []
        bulk.set(sheet, list)
        list.push(range)
        exact = false
      }
      return snapshot()
    },
    reset() {
      activeSheet = null
      sheetOrder = []
      written = new Map()
      bulk = new Map()
      overwritten = 0
      exact = true
    },
  }
}

const MAX_SHOWN_RANGES = 3

/** "A1:B3, D5 +2 more": the first ranges, the rest as a count (the caller owns the localized "+N more") */
export function formatFootprintRanges(
  ranges: readonly string[],
  more: (count: number) => string,
): string {
  const shown = ranges.slice(0, MAX_SHOWN_RANGES).join(', ')
  const rest = ranges.length - MAX_SHOWN_RANGES
  return rest > 0 ? `${shown} ${more(rest)}` : shown
}

/**
 * The one line under the applied message: "Range: A1:B3 · Cells with data overwritten: 4".
 * Zero overwritten is said plainly when the count is exact (the reassurance the user wants before
 * Save); after a bulk fill/copy the count is only a lower bound, so zero stays unsaid (unknown is not zero).
 */
export function describeFootprint(footprint: ApplyFootprint, t: TFunc): string {
  const parts: string[] = []
  if (footprint.ranges.length > 0) {
    parts.push(
      t('aiFootprintRange', {
        ranges: formatFootprintRanges(footprint.ranges, (count) => t('aiFootprintMore', { count })),
      }),
    )
  }
  if (footprint.overwritten > 0) {
    parts.push(
      t(footprint.overwrittenExact ? 'aiFootprintOverwritten' : 'aiFootprintOverwrittenMin', {
        count: footprint.overwritten,
      }),
    )
  } else if (footprint.overwrittenExact) {
    parts.push(t('aiFootprintNoOverwrite'))
  }
  return parts.join(' · ')
}

/**
 * A tool of the run finished: fold its writes into the run's ledger and put the run footprint on the
 * run's assistant message. Tools that wrote nothing leave the message alone. The caller resets the
 * ledger when a run starts, so a footprint never reaches the next run's message.
 */
export function attachRunFootprint(
  ledger: RunWriteLedger,
  // the loop hands over agent-core's ToolExecution, which has no `write`: the sheets tools add it to the very object they return
  execution: object,
  patchLastAssistant: (patch: (entry: AiChatMessage) => AiChatMessage) => void,
): void {
  const write = (execution as { write?: PlanWrite }).write
  if (!write) return
  const applyFootprint = ledger.record(write)
  patchLastAssistant((entry) => ({ ...entry, applyFootprint }))
}
