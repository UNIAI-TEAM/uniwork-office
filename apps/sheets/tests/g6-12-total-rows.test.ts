import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseRange } from '@genoffice/xlsx-gateway/domain/cell-address'
import { collectWorkbookRows } from '../src/renderer/ai/range-rows'
import { summarizeRows, type SummarizeSpec } from '../src/renderer/ai/summarize'
import {
  executeWorkbookTool,
  type SheetsSkillDeps,
  type ToolExecution,
} from '../src/renderer/ai/tools'
import { detectTotalRows } from '../src/renderer/ai/total-rows'
import type { WorkbookReadContext } from '../src/renderer/ai/workbook-readers'

afterEach(() => {
  vi.unstubAllGlobals()
})

type Scalar = string | number | boolean | null
type Row = { row: number; hidden: boolean; values: Scalar[]; formulas?: (string | undefined)[] }

/** A1:C9 — two regions with subtotal rows and a grand total. */
const ROWS: Row[] = [
  { row: 0, hidden: false, values: ['Khu vực', 'Sản phẩm', 'Doanh thu'] },
  { row: 1, hidden: false, values: ['Bắc', 'Áo', 10] },
  { row: 2, hidden: false, values: ['Bắc', 'Quần', 20] },
  {
    row: 3,
    hidden: false,
    values: [null, 'Cộng Bắc', 30],
    formulas: [undefined, undefined, '=SUBTOTAL(9,C2:C3)'],
  },
  { row: 4, hidden: false, values: ['Nam', 'Áo', 5] },
  { row: 5, hidden: false, values: ['Nam', 'Mũ', 7] },
  {
    row: 6,
    hidden: false,
    values: [null, null, 12],
    formulas: [undefined, undefined, '=SUM(C5:C6)'],
  },
  { row: 7, hidden: false, values: ['Tổng cộng', null, 42] },
  { row: 8, hidden: false, values: ['Tổng công ty', 'Áo', 1] },
]

describe('g6-12 #24: detectTotalRows', () => {
  it('finds SUBTOTAL formulas, SUM over the block above, and total labels', () => {
    expect(detectTotalRows(ROWS, { startColumn: 0, firstDataRow: 1 })).toEqual([
      { row: 3, kind: 'subtotal', reason: 'C4 =SUBTOTAL(9,C2:C3)' },
      { row: 6, kind: 'total', reason: 'C7 =SUM(C5:C6) sums the block above' },
      { row: 7, kind: 'total', reason: 'label "Tổng cộng" in A8' },
    ])
  })

  it('reads English, Chinese and Vietnamese labels but not ordinary names', () => {
    const rows = [
      'Grand Total',
      'Subtotal: North',
      'Total',
      '合计',
      'Cộng',
      'Tổng số',
      'Totalizer',
      'Tổng công ty',
    ].map((label, index) => ({ row: index, hidden: false, values: [label, 1] }))
    expect(
      detectTotalRows(rows, { startColumn: 0, firstDataRow: 0 }).map((entry) => entry.row),
    ).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('ignores the header row', () => {
    const rows = [{ row: 0, hidden: false, values: ['Total', 'Amount'] }]
    expect(detectTotalRows(rows, { startColumn: 0, firstDataRow: 1 })).toEqual([])
  })
})

const spec = (overrides: Partial<SummarizeSpec>): SummarizeSpec => ({
  startRow: 0,
  startColumn: 0,
  hasHeader: true,
  fn: 'sum',
  valueColumn: 2,
  hiddenRows: 'include',
  maxGroups: 50,
  where: [],
  ...overrides,
})

describe('g6-12 #24: summarizeRows does not double count totals', () => {
  it('leaves detected total rows out by default and reports them', () => {
    const result = summarizeRows(ROWS, spec({}))
    expect(result.result).toBe(43)
    expect(result.totalRows.map((entry) => entry.row)).toEqual([3, 6, 7])
    expect(result.rowsProcessed).toBe(5)
  })

  it('counts them when asked', () => {
    expect(summarizeRows(ROWS, spec({ totalRows: 'include' })).result).toBe(127)
  })
})

function deps(overrides: Partial<SheetsSkillDeps>): SheetsSkillDeps {
  return {
    getActiveSheetInfo: () => ({
      mode: 'demo',
      sheetId: 'sheet-1',
      sheetName: 'Bán hàng',
      revision: 0,
      knownAddresses: [],
      sheets: [{ id: 'sheet-1', name: 'Bán hàng' }],
    }),
    readCells: () => ({}),
    readFormats: () => ({}),
    readSheetFeatures: () => '',
    findCells: () => ({ matches: [], truncated: false, incompleteSheets: [] }),
    selectRange: () => ({ ok: true, sheetName: 'Bán hàng' }),
    tracePrecedents: () => ({ refs: [] }),
    traceDependents: () => ({ dependents: [], truncated: false, incompleteSheets: [] }),
    proposeOperations: () => ({ ok: false, error: 'not configured' }),
    ...overrides,
  }
}

describe('g6-12 #24: summarize_range reports total rows', () => {
  it('lists the skipped total rows with the reason and reads from the first column for labels', async () => {
    const collectRows = vi.fn().mockResolvedValue({ ok: true, rows: ROWS })
    const result = (await executeWorkbookTool(
      { id: 'c', name: 'summarize_range', input: { range: 'A1:C9', valueColumn: 'C' } },
      deps({ collectRows }),
    )) as ToolExecution
    expect(collectRows).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ startColumn: 0, endColumn: 2 }),
    )
    expect(result.output).toContain('total/subtotal rows: 3 (EXCLUDED')
    expect(result.output).toContain('row 4 subtotal: C4 =SUBTOTAL(9,C2:C3)')
    expect(result.output).toContain('result: 43')
  })

  it('declares includeTotalRows', async () => {
    const { WORKBOOK_TOOLS } = await import('../src/renderer/ai/tools')
    const tool = WORKBOOK_TOOLS.find((entry) => entry.name === 'summarize_range')
    expect(
      (tool?.inputSchema as { properties: Record<string, unknown> }).properties.includeTotalRows,
    ).toMatchObject({
      type: 'boolean',
    })
  })
})

describe('g6-12 #24: collectWorkbookRows carries formula text', () => {
  it('lazy: sidecar formulas and journal formulas', async () => {
    vi.stubGlobal('window', {
      desktopApi: {
        readWorkbookRange: vi.fn().mockResolvedValue({
          cells: [
            { row: 0, column: 0, value: 1 },
            { row: 1, column: 0, value: 1, formula: 'SUBTOTAL(9,A1)' },
          ],
          rows: [],
          indexedThroughRow: Number.MAX_SAFE_INTEGER,
        }),
      },
    })
    const ctx = {
      univerRef: { current: null },
      lazyWorkbookRef: {
        current: {
          file: {
            sessionId: 's',
            sheets: [{ id: 'sheet-1', name: 'D', rowCount: 3, columnCount: 1 }],
          },
          hiddenFileRows: new Map(),
          formulaText: new Map(),
          sharedFormulaGroups: new Map(),
          editJournal: {
            cells: new Map([
              [
                'sheet-1',
                new Map([
                  [
                    '2:0',
                    { row: 2, column: 0, hasValue: true, value: null, formula: '=SUM(A1:A2)' },
                  ],
                ]),
              ],
            ]),
            bulkConstantFills: new Map([['sheet-1', []]]),
            structuralOps: new Map(),
            definedNames: { dirty: false },
            sheets: { added: new Set(), removed: new Set() },
          },
        },
      },
      adapterRef: { current: { getSnapshot: () => ({ revision: 0, sheets: [] }) } },
    } as unknown as WorkbookReadContext
    const result = await collectWorkbookRows(ctx, 'sheet-1', parseRange('A1:A3'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows[0]?.formulas?.[0]).toBeUndefined()
    expect(result.rows[1]?.formulas?.[0]).toBe('=SUBTOTAL(9,A1)')
    expect(result.rows[2]?.formulas?.[0]).toBe('=SUM(A1:A2)')
  })
})
