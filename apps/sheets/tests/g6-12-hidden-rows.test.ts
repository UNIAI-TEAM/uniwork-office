import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseRange } from '@genoffice/xlsx-gateway/domain/cell-address'
import { aggregateWorkbookRange } from '../src/renderer/ai/aggregate-range'
import { executeWorkbookTool, type SheetsSkillDeps } from '../src/renderer/ai/tools'
import { readHiddenRows, type WorkbookReadContext } from '../src/renderer/ai/workbook-readers'

afterEach(() => {
  vi.unstubAllGlobals()
})

type Scalar = string | number | boolean | null

/** Univer facade stub: grid values plus the core worksheet's row visibility. */
function univerRef(options: {
  values?: Record<string, Scalar>
  hidden?: number[]
  filtered?: number[]
}) {
  const hidden = new Set(options.hidden ?? [])
  const filtered = new Set(options.filtered ?? [])
  const worksheet = {
    getSheetId: () => 'sheet-1',
    getRange: (address: string) => ({ getValue: () => options.values?.[address] ?? null }),
    getSheet: () => ({
      getRowFiltered: (row: number) => filtered.has(row),
      getRowRawVisible: (row: number) => !hidden.has(row),
    }),
  }
  return {
    current: {
      univerAPI: {
        getActiveWorkbook: () => ({
          getActiveSheet: () => worksheet,
          getSheetBySheetId: (id: string) => (id === 'sheet-1' ? worksheet : null),
        }),
      },
    },
  }
}

function demoCtx(
  cells: Record<string, { value: Scalar }>,
  visibility: { hidden?: number[]; filtered?: number[] },
): WorkbookReadContext {
  return {
    univerRef: univerRef(visibility),
    lazyWorkbookRef: { current: null },
    adapterRef: {
      current: {
        getSnapshot: () => ({ revision: 0, sheets: [{ id: 'sheet-1', name: 'Sheet1', cells }] }),
      },
    },
  } as unknown as WorkbookReadContext
}

function lazyCtx(rowCount: number, visibility: { filtered?: number[] } = {}): WorkbookReadContext {
  return {
    univerRef: univerRef(visibility),
    lazyWorkbookRef: {
      current: {
        file: {
          sessionId: 'session-1',
          sheets: [{ id: 'sheet-1', name: 'Data', rowCount, columnCount: 1 }],
        },
        hiddenFileRows: new Map(),
        editJournal: {
          cells: new Map([['sheet-1', new Map()]]),
          bulkConstantFills: new Map([['sheet-1', []]]),
          structuralOps: new Map(),
          sheets: { added: new Set(), removed: new Set() },
        },
      },
    },
    adapterRef: { current: { getSnapshot: () => ({ revision: 0, sheets: [] }) } },
  } as unknown as WorkbookReadContext
}

function stubSidecar(values: number[], fileHiddenRows: number[]) {
  const readWorkbookRange = vi.fn(({ range }: { range: { startRow: number; endRow: number } }) =>
    Promise.resolve({
      cells: values
        .map((value, row) => ({ row, column: 0, value }))
        .filter((cell) => cell.row >= range.startRow && cell.row <= range.endRow),
      rows: fileHiddenRows
        .filter((row) => row >= range.startRow && row <= range.endRow)
        .map((row) => ({ row, hidden: true })),
      indexedThroughRow: Number.MAX_SAFE_INTEGER,
    }),
  )
  vi.stubGlobal('window', { desktopApi: { readWorkbookRange } })
}

const DEMO_CELLS = { A1: { value: 1 }, A2: { value: 2 }, A3: { value: 4 }, A4: { value: 8 } }

describe('g6-12 #20: aggregateWorkbookRange hidden/filtered rows', () => {
  it('demo: includes hidden rows by default and reports how many', async () => {
    const result = await aggregateWorkbookRange(
      demoCtx(DEMO_CELLS, { hidden: [1], filtered: [2] }),
      'sheet-1',
      parseRange('A1:A4'),
      { hiddenRows: 'include' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.aggregate.sum).toBe(15)
    expect(result.hiddenRows).toBe(2)
  })

  it('demo: skips hidden and filtered rows on request and reports how many', async () => {
    const result = await aggregateWorkbookRange(
      demoCtx(DEMO_CELLS, { hidden: [1], filtered: [2] }),
      'sheet-1',
      parseRange('A1:A4'),
      { hiddenRows: 'skip' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.aggregate.sum).toBe(9)
    expect(result.aggregate.cells).toBe(2)
    expect(result.hiddenRows).toBe(2)
  })

  it('lazy: counts file-hidden rows and rows the live filter hides', async () => {
    stubSidecar([1, 2, 4, 8], [1])
    const ctx = lazyCtx(4, { filtered: [3] })
    const included = await aggregateWorkbookRange(ctx, 'sheet-1', parseRange('A1:A4'), {
      hiddenRows: 'include',
    })
    expect(included.ok && included.aggregate.sum).toBe(15)
    expect(included.ok && included.hiddenRows).toBe(2)
    const skipped = await aggregateWorkbookRange(ctx, 'sheet-1', parseRange('A1:A4'), {
      hiddenRows: 'skip',
    })
    expect(skipped.ok && skipped.aggregate.sum).toBe(5)
    expect(skipped.ok && skipped.hiddenRows).toBe(2)
  })
})

function toolDeps(overrides: Partial<SheetsSkillDeps>): SheetsSkillDeps {
  return {
    getActiveSheetInfo: () => ({
      mode: 'demo',
      sheetId: 'sheet-1',
      sheetName: 'Sheet1',
      revision: 0,
      knownAddresses: [],
      sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    }),
    readCells: () => ({}),
    readFormats: () => ({}),
    readSheetFeatures: () => '',
    findCells: () => ({ matches: [], truncated: false, incompleteSheets: [] }),
    selectRange: () => ({ ok: true, sheetName: 'Sheet1' }),
    tracePrecedents: () => ({ refs: [] }),
    traceDependents: () => ({ dependents: [], truncated: false, incompleteSheets: [] }),
    proposeOperations: () => ({ ok: false, error: 'not configured' }),
    ...overrides,
  }
}

const AGGREGATE = {
  cells: 4,
  nonEmpty: 4,
  distinct: 4,
  numericCount: 4,
  sum: 15,
  min: 1,
  max: 8,
  average: 3.75,
  topValues: [],
}

describe('g6-12 #20: aggregate_range tool', () => {
  it('includes hidden rows by default and says so with the count', async () => {
    const aggregateRange = vi
      .fn()
      .mockResolvedValue({ ok: true, aggregate: AGGREGATE, hiddenRows: 2 })
    const result = await executeWorkbookTool(
      { id: 'c', name: 'aggregate_range', input: { range: 'A1:A4' } },
      toolDeps({ aggregateRange }),
    )
    expect(aggregateRange).toHaveBeenCalledWith(undefined, expect.anything(), {
      hiddenRows: 'include',
    })
    expect(result.output).toContain('hidden/filtered rows in the range: 2 (INCLUDED')
  })

  it('skips hidden rows when asked and says so with the count', async () => {
    const aggregateRange = vi
      .fn()
      .mockResolvedValue({ ok: true, aggregate: AGGREGATE, hiddenRows: 3 })
    const result = await executeWorkbookTool(
      { id: 'c', name: 'aggregate_range', input: { range: 'A1:A4', skipHiddenRows: true } },
      toolDeps({ aggregateRange }),
    )
    expect(aggregateRange).toHaveBeenCalledWith(undefined, expect.anything(), {
      hiddenRows: 'skip',
    })
    expect(result.output).toContain('hidden/filtered rows in the range: 3 (SKIPPED')
  })

  it('declares the option in its input schema', async () => {
    const { WORKBOOK_TOOLS } = await import('../src/renderer/ai/tools')
    const tool = WORKBOOK_TOOLS.find((entry) => entry.name === 'aggregate_range')
    const properties = (tool?.inputSchema as { properties: Record<string, unknown> }).properties
    expect(properties.skipHiddenRows).toMatchObject({ type: 'boolean' })
  })
})

describe('g6-12 #20: read_range marks hidden rows', () => {
  it('labels hidden and filtered rows in the grid and lists them', async () => {
    const readCells = vi.fn().mockReturnValue({
      A1: { value: 'a' },
      A2: { value: 'b' },
      A3: { value: 'c' },
    })
    const hiddenRows = vi.fn().mockReturnValue([
      { row: 1, reason: 'hidden' },
      { row: 2, reason: 'filtered' },
    ])
    const result = await executeWorkbookTool(
      { id: 'c', name: 'read_range', input: { range: 'A1:A3' } },
      toolDeps({ readCells, hiddenRows }),
    )
    expect(hiddenRows).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ startRow: 0, endRow: 2 }),
    )
    const lines = result.output.split('\n')
    expect(lines[2]).toBe('1\ta')
    expect(lines[3]).toBe('2 (hidden)\tb')
    expect(lines[4]).toBe('3 (filtered out)\tc')
    expect(result.output).toContain('Hidden rows in this range: 2 (hidden), 3 (filtered out)')
  })

  it('reads row visibility from the live grid', () => {
    const ctx = demoCtx(DEMO_CELLS, { hidden: [1], filtered: [3] })
    expect(readHiddenRows(ctx, parseRange('A1:A4'))).toEqual([
      { row: 1, reason: 'hidden' },
      { row: 3, reason: 'filtered' },
    ])
  })
})
