import { describe, expect, it } from 'vitest'
import type { ChangePlan } from '@genoffice/xlsx-gateway/domain/workbook.types'
import type { WorkbookOperation } from '@genoffice/xlsx-gateway/domain/workbook-dsl'

import {
  createRunWriteLedger,
  formatFootprintRanges,
  planWrite,
} from '../src/renderer/ai/apply-footprint'

// G6-09 W6 (audit row 18): the assistant message names the range(s) a run wrote and how many cells
// that already held data it overwrote, aggregated over the whole run (not per tool).

const sheets = [
  { id: 's1', name: 'Sheet1' },
  { id: 's2', name: 'Q3 Budget' },
]
const info = { sheetId: 's1', sheetName: 'Sheet1', sheets }

type Cell = { sheetId: string; address: string; before?: unknown; after?: unknown }

function plan(cells: Cell[]): ChangePlan {
  return {
    transactionId: 't',
    baseRevision: 0,
    cellChanges: cells.map((c) => ({
      sheetId: c.sheetId,
      address: c.address,
      before: { value: (c.before ?? null) as never },
      after: { value: (c.after ?? 1) as never },
    })),
    sheetRenames: [],
    structuralChanges: [],
    formatChanges: [],
    warnings: [],
  }
}

/** A1:B3 on s1; the cells in `filled` held data before */
function block(sheetId: string, filled: readonly string[]): Cell[] {
  const cells: Cell[] = []
  for (const col of ['A', 'B']) {
    for (const row of [1, 2, 3]) {
      const address = `${col}${row}`
      cells.push({
        sheetId,
        address,
        before: filled.includes(address) ? 'old' : null,
        after: 'new',
      })
    }
  }
  return cells
}

describe('planWrite', () => {
  it('flags a cell that held data and changed as overwritten; a new cell is not', () => {
    const write = planWrite(plan(block('s1', ['A1', 'A2', 'B1', 'B2'])), [], info)
    expect(write.cells).toHaveLength(6)
    expect(write.cells.filter((c) => c.overwrote)).toHaveLength(4)
    expect(write.cells[0]).toMatchObject({ sheet: 'Sheet1', row: 0, column: 0, overwrote: true })
  })

  it('counts a formula as data, and rewriting the same value as no overwrite', () => {
    const p: ChangePlan = {
      ...plan([]),
      cellChanges: [
        {
          sheetId: 's1',
          address: 'A1',
          before: { value: 3, formula: '=1+2' },
          after: { value: 'x' },
        },
        { sheetId: 's1', address: 'A2', before: { value: 5 }, after: { value: 5 } },
        { sheetId: 's1', address: 'A3', before: { value: '' }, after: { value: 7 } },
      ],
    }
    const write = planWrite(p, [], info)
    expect(write.cells.map((c) => c.overwrote)).toEqual([true, false, false])
  })

  it('takes fill_range and copy_range targets as ranges (they have no per-cell plan entries)', () => {
    const operations = [
      { op: 'fill_range', sheetId: 's2', source: 'A1', target: 'A2:A9' },
      { op: 'copy_range', sheetId: 's1', source: 'A1:B2', target: 'D1' },
    ] as unknown as WorkbookOperation[]
    const write = planWrite(plan([]), operations, info)
    expect(write.bulkRanges).toEqual([
      { sheet: 'Q3 Budget', range: 'A2:A9' },
      { sheet: 'Sheet1', range: 'D1:E2' },
    ])
  })
})

describe('run write ledger', () => {
  it('a run writing A1:B3 over 4 filled cells -> one range, 4 overwritten', () => {
    const ledger = createRunWriteLedger()
    const fp = ledger.record(planWrite(plan(block('s1', ['A1', 'A2', 'B1', 'B2'])), [], info))
    expect(fp.ranges).toEqual(['A1:B3'])
    expect(fp.overwritten).toBe(4)
    expect(fp.overwrittenExact).toBe(true)
  })

  it('a new-cells-only run -> 0 overwritten (exact)', () => {
    const ledger = createRunWriteLedger()
    const fp = ledger.record(planWrite(plan(block('s1', [])), [], info))
    expect(fp.ranges).toEqual(['A1:B3'])
    expect(fp.overwritten).toBe(0)
    expect(fp.overwrittenExact).toBe(true)
  })

  it('two ranges on two sheets: the active sheet is bare, the other carries its (quoted) name', () => {
    const ledger = createRunWriteLedger()
    ledger.record(planWrite(plan(block('s1', ['A1'])), [], info))
    const fp = ledger.record(
      planWrite(plan([{ sheetId: 's2', address: 'D5', before: 9, after: 10 }]), [], info),
    )
    expect(fp.ranges).toEqual(['A1:B3', "'Q3 Budget'!D5"])
    expect(fp.overwritten).toBe(2)
  })

  it('aggregates across tools of one run: a cell written twice counts once, and not as overwritten when the run itself created it', () => {
    const ledger = createRunWriteLedger()
    ledger.record(
      planWrite(plan([{ sheetId: 's1', address: 'A1', before: null, after: 1 }]), [], info),
    )
    const fp = ledger.record(
      planWrite(
        plan([
          { sheetId: 's1', address: 'A1', before: 1, after: 2 },
          { sheetId: 's1', address: 'A2', before: 'old', after: 2 },
        ]),
        [],
        info,
      ),
    )
    expect(fp.ranges).toEqual(['A1:A2'])
    expect(fp.overwritten).toBe(1)
  })

  it('a sparse write is listed as separate ranges, not one box over untouched cells', () => {
    const ledger = createRunWriteLedger()
    const fp = ledger.record(
      planWrite(
        plan([
          { sheetId: 's1', address: 'A1' },
          { sheetId: 's1', address: 'Z99' },
        ]),
        [],
        info,
      ),
    )
    expect(fp.ranges).toEqual(['A1', 'Z99'])
  })

  it('bulk fill/copy contributes its range but makes the overwritten count a lower bound', () => {
    const ledger = createRunWriteLedger()
    const operations = [
      { op: 'fill_range', sheetId: 's1', source: 'A1', target: 'A2:A9' },
    ] as unknown as WorkbookOperation[]
    const fp = ledger.record(planWrite(plan([]), operations, info))
    expect(fp.ranges).toEqual(['A2:A9'])
    expect(fp.overwritten).toBe(0)
    expect(fp.overwrittenExact).toBe(false)
  })

  it('reset starts the next run from nothing', () => {
    const ledger = createRunWriteLedger()
    ledger.record(planWrite(plan(block('s1', ['A1'])), [], info))
    ledger.reset()
    const fp = ledger.record(planWrite(plan([{ sheetId: 's1', address: 'C1' }]), [], info))
    expect(fp.ranges).toEqual(['C1'])
    expect(fp.overwritten).toBe(0)
  })
})

describe('formatFootprintRanges', () => {
  it('shows up to three ranges and caps the rest with +N more', () => {
    const ranges = ['A1', 'B2', 'C3', 'D4', 'E5']
    expect(formatFootprintRanges(ranges, (n) => `+${n} more`)).toBe('A1, B2, C3 +2 more')
    expect(formatFootprintRanges(ranges.slice(0, 3), (n) => `+${n} more`)).toBe('A1, B2, C3')
  })
})
