import { describe, expect, it, vi } from 'vitest'

import { reconcileRows, type ReconcileSpec } from '../src/renderer/ai/reconcile'
import {
  WORKBOOK_TOOLS,
  executeWorkbookTool,
  type SheetsSkillDeps,
  type ToolExecution,
} from '../src/renderer/ai/tools'
import { VIEW_ONLY_TOOLS } from '../src/renderer/ai/view-only-skill'

type Scalar = string | number | boolean | null
type Row = { row: number; hidden: boolean; values: Scalar[]; cached?: boolean[] }

/** Sheet "Sổ cái" A1:C7: Mã | Khách hàng | Số tiền (with a blank key, a duplicate and a total row). */
const LEFT: Row[] = [
  { row: 0, hidden: false, values: ['Mã', 'Khách hàng', 'Số tiền'] },
  { row: 1, hidden: false, values: ['K001', 'An', 100] },
  { row: 2, hidden: false, values: ['K002', 'Bình', 200] },
  { row: 3, hidden: false, values: ['K003', 'Chi', 300] },
  { row: 4, hidden: false, values: [null, 'không mã', 5] },
  { row: 5, hidden: false, values: ['k001', 'An (trùng)', 999] },
  { row: 6, hidden: false, values: ['Tổng cộng', null, 1604] },
]

/** Sheet "Ngân hàng" A1:B5: Số tiền | Mã (other column order, number-as-text key). */
const RIGHT: Row[] = [
  { row: 0, hidden: false, values: ['Số tiền', 'Mã'] },
  { row: 1, hidden: false, values: [100, 'K001'] },
  { row: 2, hidden: false, values: [250, 'K002'] },
  { row: 3, hidden: false, values: [40, 'K004'] },
  { row: 4, hidden: true, values: ['300', 'K003'] },
]

const spec = (overrides: Partial<ReconcileSpec> = {}): ReconcileSpec => ({
  left: { rows: LEFT, startRow: 0, startColumn: 0, keyColumn: 0 },
  right: { rows: RIGHT, startRow: 0, startColumn: 0, keyColumn: 1 },
  hasHeader: true,
  hiddenRows: 'include',
  totalRows: 'skip',
  tolerance: 0,
  ...overrides,
})

describe('g6-12 #24b: reconcileRows', () => {
  it('matches keys case-insensitively, pairs columns by header and reports every gap', () => {
    const result = reconcileRows(spec())
    expect(result.pairs).toEqual([[2, 0]])
    expect(result.left).toMatchObject({ rowsProcessed: 5, keys: 3, blankKeys: 1 })
    expect(result.left.duplicateKeys).toEqual([{ key: 'K001', rows: [1, 5] }])
    expect(result.left.totalRows.map((entry) => entry.row)).toEqual([6])
    expect(result.right).toMatchObject({ rowsProcessed: 4, keys: 4, hiddenRows: 1 })
    expect(result.matched).toBe(3)
    expect(result.identical).toBe(1)
    expect(result.onlyLeft).toEqual([])
    expect(result.onlyRight).toEqual([{ key: 'K004', row: 3 }])
    expect(result.differences).toEqual([
      {
        key: 'K002',
        leftRow: 2,
        rightRow: 2,
        leftColumn: 2,
        rightColumn: 0,
        left: 200,
        right: 250,
        delta: 50,
      },
      {
        key: 'K003',
        leftRow: 3,
        rightRow: 4,
        leftColumn: 2,
        rightColumn: 0,
        left: 300,
        right: '300',
      },
    ])
  })

  it('honours tolerance, explicit column pairs and skipped hidden rows', () => {
    const result = reconcileRows(spec({ tolerance: 50, pairs: [[2, 0]], hiddenRows: 'skip' }))
    expect(result.differences).toEqual([])
    expect(result.onlyLeft).toEqual([{ key: 'K003', row: 3 }])
    expect(result.right.hiddenRows).toBe(1)
  })

  it('counts cached formula cells among keys and compared values', () => {
    const left: Row[] = [
      { row: 0, hidden: false, values: ['Mã', 'Tiền'] },
      { row: 1, hidden: false, values: ['A', 1], cached: [false, true] },
    ]
    const right: Row[] = [
      { row: 0, hidden: false, values: ['Mã', 'Tiền'] },
      { row: 1, hidden: false, values: ['A', 1] },
    ]
    const result = reconcileRows(
      spec({
        left: { rows: left, startRow: 0, startColumn: 0, keyColumn: 0 },
        right: { rows: right, startRow: 0, startColumn: 0, keyColumn: 0 },
      }),
    )
    expect(result.left.cachedFormulaCells).toBe(1)
  })
})

function deps(overrides: Partial<SheetsSkillDeps>): SheetsSkillDeps {
  return {
    getActiveSheetInfo: () => ({
      mode: 'demo',
      sheetId: 's-ledger',
      sheetName: 'Sổ cái',
      revision: 0,
      knownAddresses: [],
      sheets: [
        { id: 's-ledger', name: 'Sổ cái' },
        { id: 's-bank', name: 'Ngân hàng' },
      ],
    }),
    readCells: () => ({}),
    readFormats: () => ({}),
    readSheetFeatures: () => '',
    findCells: () => ({ matches: [], truncated: false, incompleteSheets: [] }),
    selectRange: () => ({ ok: true, sheetName: 'Sổ cái' }),
    tracePrecedents: () => ({ refs: [] }),
    traceDependents: () => ({ dependents: [], truncated: false, incompleteSheets: [] }),
    proposeOperations: () => ({ ok: false, error: 'not configured' }),
    ...overrides,
  }
}

const collect = () =>
  vi.fn((sheetId: string | undefined) =>
    Promise.resolve({ ok: true, rows: sheetId === 's-bank' ? RIGHT : LEFT }),
  )

describe('g6-12 #24b: compare_ranges tool', () => {
  it('is declared read-only with an input schema and offered on view-only workbooks', () => {
    const tool = WORKBOOK_TOOLS.find((entry) => entry.name === 'compare_ranges')
    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['leftRange', 'leftKey', 'rightRange', 'rightKey'],
    })
    expect(VIEW_ONLY_TOOLS.has('compare_ranges')).toBe(true)
  })

  it('reports matched / missing / different with coverage', async () => {
    const collectRows = collect()
    const result = (await executeWorkbookTool(
      {
        id: 'c',
        name: 'compare_ranges',
        input: {
          leftRange: 'A1:C7',
          leftKey: 'A',
          rightRange: 'A1:B5',
          rightSheetId: 's-bank',
          rightKey: 'B',
        },
      },
      deps({ collectRows }),
    )) as ToolExecution
    expect(result.isError).toBeFalsy()
    expect(result.mutated).toBe(false)
    expect(collectRows).toHaveBeenCalledWith(undefined, expect.objectContaining({ endColumn: 2 }))
    expect(collectRows).toHaveBeenCalledWith('s-bank', expect.objectContaining({ endColumn: 1 }))
    expect(result.output).toContain('Sổ cái!A2:C7')
    expect(result.output).toContain('Ngân hàng!A2:B5')
    expect(result.output).toContain('C "Số tiền" ↔ A "Số tiền"')
    expect(result.output).toContain('matched keys: 3 (1 identical, 2 with differences)')
    expect(result.output).toContain('only in right: 1')
    expect(result.output).toContain('"K004" (row 4)')
    expect(result.output).toContain('"K002": C "Số tiền" 200 ↔ A "Số tiền" 250 (right − left = 50)')
    expect(result.output).toContain('"K003": C "Số tiền" 300 ↔ A "Số tiền" "300" (number vs text)')
    expect(result.output).toContain('blank keys: 1')
    expect(result.output).toContain('duplicate keys: 1')
    expect(result.output).toContain('total/subtotal rows excluded: 1')
  })

  it('rejects key columns outside the ranges and unequal explicit column lists', async () => {
    const collectRows = collect()
    const outside = (await executeWorkbookTool(
      {
        id: 'c',
        name: 'compare_ranges',
        input: { leftRange: 'A1:C7', leftKey: 'F', rightRange: 'A1:B5', rightKey: 'B' },
      },
      deps({ collectRows }),
    )) as ToolExecution
    expect(outside.isError).toBe(true)
    const unequal = (await executeWorkbookTool(
      {
        id: 'c',
        name: 'compare_ranges',
        input: {
          leftRange: 'A1:C7',
          leftKey: 'A',
          leftColumns: ['B', 'C'],
          rightRange: 'A1:B5',
          rightKey: 'B',
          rightColumns: ['A'],
        },
      },
      deps({ collectRows }),
    )) as ToolExecution
    expect(unequal.isError).toBe(true)
    expect(collectRows).not.toHaveBeenCalled()
  })

  it('withholds the comparison when compared values are stale cached formulas', async () => {
    const rows: Row[] = [
      { row: 0, hidden: false, values: ['Mã', 'Tiền'] },
      { row: 1, hidden: false, values: ['A', 1], cached: [false, true] },
    ]
    const result = (await executeWorkbookTool(
      {
        id: 'c',
        name: 'compare_ranges',
        input: { leftRange: 'A1:B2', leftKey: 'A', rightRange: 'A1:B2', rightKey: 'A' },
      },
      deps({ collectRows: vi.fn().mockResolvedValue({ ok: true, rows, staleInputs: true }) }),
    )) as ToolExecution
    expect(result.output).toContain('NOT RECALCULATED')
    expect(result.output).not.toContain('matched keys')
  })
})
