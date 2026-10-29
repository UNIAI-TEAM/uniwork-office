import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseRange } from '@genoffice/xlsx-gateway/domain/cell-address'
import { collectWorkbookRows } from '../src/renderer/ai/range-rows'
import { buildRedactionIndex } from '../src/renderer/ai/redact'
import { summarizeRows, type SummarizeSpec } from '../src/renderer/ai/summarize'
import {
  WORKBOOK_TOOLS,
  executeWorkbookTool,
  type SheetsSkillDeps,
  type ToolExecution,
} from '../src/renderer/ai/tools'
import { VIEW_ONLY_TOOLS } from '../src/renderer/ai/view-only-skill'
import type { WorkbookReadContext } from '../src/renderer/ai/workbook-readers'

afterEach(() => {
  vi.unstubAllGlobals()
})

type Scalar = string | number | boolean | null
type Row = { row: number; hidden: boolean; values: Scalar[]; cached?: boolean[] }

/** A1:D8 — Vietnamese sales data with a hidden row, a text amount, an error and a total row. */
const ROWS: Row[] = [
  { row: 0, hidden: false, values: ['Khu vực', 'Sản phẩm', 'Số lượng', 'Giảm giá'] },
  { row: 1, hidden: false, values: ['Hà Nội', 'Áo', 10, 0.1] },
  { row: 2, hidden: false, values: ['Hà Nội', 'Quần', 5, 10] },
  { row: 3, hidden: true, values: ['Hà Nội', 'Áo', 7, 0] },
  { row: 4, hidden: false, values: ['Đà Nẵng', 'Áo', '1.234,5', 0] },
  { row: 5, hidden: false, values: ['Đà Nẵng', 'Quần', '#N/A', 0] },
  { row: 6, hidden: false, values: ['hà nội', 'Mũ', 3, null] },
  { row: 7, hidden: false, values: [null, null, null, null] },
]

const base = (spec: Partial<SummarizeSpec>): SummarizeSpec => ({
  startRow: 0,
  startColumn: 0,
  hasHeader: true,
  fn: 'sum',
  hiddenRows: 'include',
  maxGroups: 50,
  where: [],
  ...spec,
})

describe('g6-12 #21: summarizeRows', () => {
  it('sums a column under a condition with full coverage of skipped cells', () => {
    const result = summarizeRows(
      ROWS,
      base({ valueColumn: 2, where: [{ column: 0, op: '=', value: 'Hà Nội' }] }),
    )
    // rows 2,3,4 and "hà nội" (case-insensitive like SUMIF) => 10+5+7+3
    expect(result.result).toBe(25)
    expect(result.rowsProcessed).toBe(7)
    expect(result.rowsMatched).toBe(4)
    expect(result.valuesUsed).toBe(4)
    expect(result.hiddenRows).toBe(1)
  })

  it('never casts text to a number and says which cells were skipped and why', () => {
    const result = summarizeRows(ROWS, base({ valueColumn: 2 }))
    expect(result.result).toBe(25)
    expect(result.skipped.text.count).toBe(1)
    expect(result.skipped.text.examples[0]).toEqual({ address: 'C5', value: '1.234,5' })
    expect(result.skipped.error.count).toBe(1)
    expect(result.skipped.blank.count).toBe(1)
  })

  it('skips hidden rows on request and still counts them', () => {
    const result = summarizeRows(ROWS, base({ valueColumn: 2, hiddenRows: 'skip' }))
    expect(result.result).toBe(18)
    expect(result.hiddenRows).toBe(1)
    expect(result.rowsProcessed).toBe(6)
  })

  it('groups and averages; numeric comparisons only match numbers', () => {
    const result = summarizeRows(
      ROWS,
      base({
        fn: 'average',
        valueColumn: 2,
        groupBy: 1,
        where: [{ column: 2, op: '>=', value: 5 }],
      }),
    )
    expect(result.groups.map((group) => [group.key, group.result, group.rows])).toEqual([
      ['Áo', 8.5, 2],
      ['Quần', 5, 1],
    ])
    // "1.234,5" and "#N/A" cannot be compared with >= 5
    expect(result.criteriaNotComparable).toBe(2)
  })

  it('counts matching rows and handles blank / contains', () => {
    expect(
      summarizeRows(
        ROWS,
        base({ fn: 'count', where: [{ column: 1, op: 'contains', value: 'Qu' }] }),
      ).result,
    ).toBe(2)
    expect(
      summarizeRows(ROWS, base({ fn: 'count', where: [{ column: 3, op: 'blank' }] })).result,
    ).toBe(2)
  })

  it('keeps 10 and 10 % (raw 0.1) distinct', () => {
    const result = summarizeRows(
      ROWS,
      base({ valueColumn: 3, where: [{ column: 0, op: '=', value: 'Hà Nội' }] }),
    )
    expect(result.result).toBeCloseTo(10.1, 10)
  })

  it('reports cached formula values among the cells it used', () => {
    const rows: Row[] = [
      { row: 0, hidden: false, values: ['x'] },
      { row: 1, hidden: false, values: [4], cached: [true] },
      { row: 2, hidden: false, values: [6], cached: [false] },
    ]
    expect(summarizeRows(rows, base({ valueColumn: 0 })).cachedFormulaCells).toBe(1)
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

const run = (input: Record<string, unknown>, d: SheetsSkillDeps) =>
  executeWorkbookTool({ id: 'c', name: 'summarize_range', input }, d) as Promise<ToolExecution>

describe('g6-12 #21: summarize_range tool', () => {
  it('is a declared, read-only tool with an input schema, offered on view-only workbooks', () => {
    const tool = WORKBOOK_TOOLS.find((entry) => entry.name === 'summarize_range')
    expect(tool?.inputSchema).toMatchObject({ type: 'object', required: ['range'] })
    expect(Object.keys((tool?.inputSchema as { properties: object }).properties)).toEqual(
      expect.arrayContaining([
        'range',
        'sheetId',
        'function',
        'valueColumn',
        'where',
        'groupBy',
        'skipHiddenRows',
      ]),
    )
    expect(VIEW_ONLY_TOOLS.has('summarize_range')).toBe(true)
  })

  it('computes in code and reports range, filter, coverage and hidden rows', async () => {
    const collectRows = vi.fn().mockResolvedValue({ ok: true, rows: ROWS })
    const result = await run(
      {
        range: 'A1:D8',
        function: 'sum',
        valueColumn: 'C',
        where: [{ column: 'A', op: '=', value: 'Hà Nội' }],
        groupBy: 'B',
      },
      deps({ collectRows }),
    )
    expect(result.isError).toBeFalsy()
    expect(result.mutated).toBe(false)
    expect(collectRows).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ startRow: 0, endRow: 7, startColumn: 0, endColumn: 2 }),
    )
    expect(result.output).toContain('Bán hàng!A2:D8')
    expect(result.output).toContain('sum of C "Số lượng"')
    expect(result.output).toContain('A "Khu vực" = "Hà Nội"')
    expect(result.output).toContain('rows processed: 7')
    expect(result.output).toContain('rows matching: 4')
    expect(result.output).toContain('hidden/filtered rows: 1 (included')
    expect(result.output).toContain('result: 25')
    expect(result.output).toContain('Áo: 17')
  })

  it('rejects sum without a value column and columns outside the range', async () => {
    const collectRows = vi.fn()
    expect((await run({ range: 'A1:D8', function: 'sum' }, deps({ collectRows }))).isError).toBe(
      true,
    )
    const outside = await run(
      { range: 'A1:D8', function: 'sum', valueColumn: 'F' },
      deps({ collectRows }),
    )
    expect(outside.isError).toBe(true)
    expect(outside.output).toContain('outside the range')
    expect(collectRows).not.toHaveBeenCalled()
  })

  it('withholds a result built on stale cached formula values', async () => {
    const rows: Row[] = [
      { row: 0, hidden: false, values: ['Tiền'] },
      { row: 1, hidden: false, values: [4], cached: [true] },
    ]
    const result = await run(
      { range: 'A1:A2', valueColumn: 'A' },
      deps({ collectRows: vi.fn().mockResolvedValue({ ok: true, rows, staleInputs: true }) }),
    )
    expect(result.output).toContain('NOT RECALCULATED')
    expect(result.output).not.toContain('result: 4')
  })
})

describe('g6-12 #21: collectWorkbookRows', () => {
  it('demo: returns values per row with hidden flags', async () => {
    const worksheet = {
      getSheetId: () => 'sheet-1',
      getRange: () => ({ getValue: () => null, getCellDatas: () => [[{}]] }),
      getSheet: () => ({
        getRowFiltered: (row: number) => row === 1,
        getRowRawVisible: () => true,
      }),
    }
    const ctx = {
      univerRef: {
        current: {
          univerAPI: {
            getActiveWorkbook: () => ({
              getActiveSheet: () => worksheet,
              getSheetBySheetId: () => worksheet,
            }),
          },
        },
      },
      lazyWorkbookRef: { current: null },
      adapterRef: {
        current: {
          getSnapshot: () => ({
            revision: 0,
            sheets: [{ id: 'sheet-1', name: 'S', cells: { A1: { value: 'x' }, B2: { value: 2 } } }],
          }),
        },
      },
    } as unknown as WorkbookReadContext
    const result = await collectWorkbookRows(ctx, undefined, parseRange('A1:B2'))
    expect(result).toMatchObject({
      ok: true,
      rows: [
        { row: 0, hidden: false, values: ['x', null] },
        { row: 1, hidden: true, values: [null, 2] },
      ],
    })
  })

  it('lazy: merges sidecar cells, journal edits and fills, flags cached formulas', async () => {
    vi.stubGlobal('window', {
      desktopApi: {
        readWorkbookRange: vi.fn().mockResolvedValue({
          cells: [
            { row: 0, column: 0, value: 1 },
            { row: 1, column: 0, value: 2, formula: 'A1*2' },
            { row: 2, column: 0, value: 3 },
          ],
          rows: [{ row: 2, hidden: true }],
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
            sheets: [{ id: 'sheet-1', name: 'Data', rowCount: 3, columnCount: 2 }],
          },
          hiddenFileRows: new Map(),
          formulaText: new Map(),
          sharedFormulaGroups: new Map(),
          editJournal: {
            cells: new Map([
              ['sheet-1', new Map([['0:0', { row: 0, column: 0, hasValue: true, value: 10 }]])],
            ]),
            bulkConstantFills: new Map([
              ['sheet-1', [{ startRow: 0, endRow: 2, startColumn: 1, endColumn: 1, value: 'k' }]],
            ]),
            structuralOps: new Map(),
            definedNames: { dirty: false },
            sheets: { added: new Set(), removed: new Set() },
          },
        },
      },
      adapterRef: { current: { getSnapshot: () => ({ revision: 0, sheets: [] }) } },
    } as unknown as WorkbookReadContext
    const result = await collectWorkbookRows(ctx, 'sheet-1', parseRange('A1:B3'))
    expect(result).toMatchObject({
      ok: true,
      staleInputs: true,
      rows: [
        { row: 0, hidden: false, values: [10, 'k'], cached: [false, false] },
        { row: 1, hidden: false, values: [2, 'k'], cached: [true, false] },
        { row: 2, hidden: true, values: [3, 'k'], cached: [false, false] },
      ],
    })
  })

  it('projects withheld cells to placeholders in demo and lazy modes and excludes them from sums', async () => {
    const redactions = buildRedactionIndex(
      [
        {
          sheetName: 'Data',
          marks: [
            { startRow: 1, endRow: 1, startColumn: 0, endColumn: 0, label: 'region' },
            { startRow: 2, endRow: 2, startColumn: 1, endColumn: 1, label: 'amount' },
          ],
        },
      ],
      [{ id: 'sheet-1', name: 'Data' }],
    )
    const demoCtx = {
      univerRef: { current: null },
      lazyWorkbookRef: { current: null },
      adapterRef: {
        current: {
          getSnapshot: () => ({
            revision: 0,
            sheets: [
              {
                id: 'sheet-1',
                name: 'Data',
                cells: {
                  A1: { value: 'Region' },
                  B1: { value: 'Sales' },
                  A2: { value: 'SecretRegion' },
                  B2: { value: 10 },
                  A3: { value: 'North', formula: '=A2' },
                  B3: { value: 999, formula: '=1000-1' },
                },
              },
            ],
          }),
        },
      },
      redactionIndexRef: { current: redactions },
    } as unknown as WorkbookReadContext

    const demoOutcome = await collectWorkbookRows(demoCtx, 'sheet-1', parseRange('A1:B3'))
    expect(demoOutcome.ok).toBe(true)
    if (!demoOutcome.ok) return
    expect(demoOutcome.rows[1]?.values).toEqual(['{{region}}', 10])
    expect(demoOutcome.rows[1]?.withheld).toEqual([true, false])
    expect(demoOutcome.rows[2]?.values).toEqual(['North', '{{amount}}'])
    expect(demoOutcome.rows[2]?.withheld).toEqual([false, true])
    expect(demoOutcome.rows[2]?.formulas?.[1]).toBeUndefined()

    const summary = summarizeRows(demoOutcome.rows, base({ valueColumn: 1, groupBy: 0 }))
    expect(summary.result).toBe(10)
    expect(summary.withheld).toBe(1)
    expect(summary.skipped.text.count).toBe(0)
    expect(summary.groups).toEqual([
      { key: '{{region}}', rows: 1, valuesUsed: 1, result: 10 },
      { key: 'North', rows: 1, valuesUsed: 0, result: 0 },
    ])
    expect(JSON.stringify(summary)).not.toContain('SecretRegion')
    expect(JSON.stringify(summary)).not.toContain('999')

    const toolResult = await run(
      { range: 'A1:B3', function: 'sum', valueColumn: 'B', groupBy: 'A' },
      deps({ collectRows: vi.fn().mockResolvedValue(demoOutcome) }),
    )
    expect(toolResult.output).toContain('withheld: 1')
    expect(toolResult.output).toContain('{{region}}: 10')
    expect(toolResult.output).not.toContain('SecretRegion')
    expect(toolResult.output).not.toContain('999')

    vi.stubGlobal('window', {
      desktopApi: {
        readWorkbookRange: vi.fn().mockResolvedValue({
          cells: [
            { row: 0, column: 0, value: 'Region' },
            { row: 0, column: 1, value: 'Sales' },
            { row: 1, column: 0, value: 'SecretRegion' },
            { row: 1, column: 1, value: 10 },
            { row: 2, column: 0, value: 'North' },
            { row: 2, column: 1, value: 999, formula: '1000-1' },
          ],
          rows: [],
          indexedThroughRow: Number.MAX_SAFE_INTEGER,
        }),
      },
    })
    const lazyCtx = {
      univerRef: { current: null },
      lazyWorkbookRef: {
        current: {
          file: {
            sessionId: 's',
            sheets: [{ id: 'sheet-1', name: 'Data', rowCount: 3, columnCount: 2 }],
          },
          hiddenFileRows: new Map(),
          formulaText: new Map(),
          sharedFormulaGroups: new Map(),
          editJournal: {
            cells: new Map(),
            bulkConstantFills: new Map(),
            structuralOps: new Map(),
            definedNames: { dirty: false },
            sheets: { added: new Set(), removed: new Set() },
          },
        },
      },
      adapterRef: { current: { getSnapshot: () => ({ revision: 0, sheets: [] }) } },
      redactionIndexRef: { current: redactions },
    } as unknown as WorkbookReadContext

    const lazyOutcome = await collectWorkbookRows(lazyCtx, 'sheet-1', parseRange('A1:B3'))
    expect(lazyOutcome.ok).toBe(true)
    if (!lazyOutcome.ok) return
    expect(lazyOutcome.rows[1]?.values).toEqual(['{{region}}', 10])
    expect(lazyOutcome.rows[1]?.withheld).toEqual([true, false])
    expect(lazyOutcome.rows[2]?.values).toEqual(['North', '{{amount}}'])
    expect(lazyOutcome.rows[2]?.withheld).toEqual([false, true])
    expect(lazyOutcome.rows[2]?.cached).toEqual([false, false])
    expect(lazyOutcome.rows[2]?.formulas).toBeUndefined()
  })
})
