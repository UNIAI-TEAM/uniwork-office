import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseRange } from '@genoffice/xlsx-gateway/domain/cell-address'
import { aggregateWorkbookRange } from '../src/renderer/ai/aggregate-range'
import { formulaProvenance } from '../src/renderer/ai/cell-read'
import {
  executeWorkbookTool,
  type SheetsSkillDeps,
  type ToolExecution,
} from '../src/renderer/ai/tools'
import { readCells, type WorkbookReadContext } from '../src/renderer/ai/workbook-readers'
import type { LazyWorkbookState } from '../src/renderer/univer-state'

afterEach(() => {
  vi.unstubAllGlobals()
})

type Scalar = string | number | boolean | null

function lazyState(options: {
  formulaMode?: boolean
  formulaText?: Record<string, string>
  editedCells?: string[]
  overlay?: string[]
}): LazyWorkbookState {
  return {
    formulaMode: options.formulaMode ?? false,
    file: {
      sessionId: 'session-1',
      sheets: [{ id: 'sheet-1', name: 'Data', rowCount: 3, columnCount: 1 }],
    },
    hiddenFileRows: new Map(),
    formulaText: new Map([['sheet-1', new Map(Object.entries(options.formulaText ?? {}))]]),
    sharedFormulaGroups: new Map(),
    recalc: {
      overlay: new Map([
        ['sheet-1', new Map((options.overlay ?? []).map((key) => [key, { v: 1 }]))],
      ]),
    },
    editJournal: {
      cells: new Map([
        [
          'sheet-1',
          new Map(
            (options.editedCells ?? []).map((key) => {
              const [row, column] = key.split(':').map(Number)
              return [key, { row, column, hasValue: true, value: 5 }]
            }),
          ),
        ],
      ]),
      bulkConstantFills: new Map([['sheet-1', []]]),
      structuralOps: new Map(),
      definedNames: { dirty: false },
      sheets: { added: new Set(), removed: new Set() },
    },
  } as unknown as LazyWorkbookState
}

describe('g6-12 #22: formulaProvenance', () => {
  it('a formula the engine owns is a fresh engine result', () => {
    const state = lazyState({ formulaMode: true })
    expect(
      formulaProvenance(state, 'sheet-1', 0, 0, {
        formula: '=1+1',
        modelHasFormula: true,
        value: 2,
        rawValue: 2,
      }),
    ).toMatchObject({ formula: '=1+1', source: 'engine', stale: false })
  })

  it('a streamed formula with only a cached value is flagged as cache, fresh while nothing was edited', () => {
    const state = lazyState({ formulaText: { '1:0': '=SUM(A1)' } })
    expect(
      formulaProvenance(state, 'sheet-1', 1, 0, { modelHasFormula: false, value: 7, rawValue: 7 }),
    ).toMatchObject({ formula: '=SUM(A1)', source: 'cache', stale: false })
  })

  it('a cached value becomes stale once cells were edited this session', () => {
    const state = lazyState({ formulaText: { '1:0': '=SUM(A1)' }, editedCells: ['0:0'] })
    expect(
      formulaProvenance(state, 'sheet-1', 1, 0, { modelHasFormula: false, value: 7, rawValue: 7 }),
    ).toMatchObject({ source: 'cache', stale: true })
  })

  it('an IronCalc recalc overlay value counts as an engine result', () => {
    const state = lazyState({
      formulaText: { '1:0': '=SUM(A1)' },
      overlay: ['1:0'],
      editedCells: ['0:0'],
    })
    expect(
      formulaProvenance(state, 'sheet-1', 1, 0, { modelHasFormula: false, value: 7, rawValue: 7 }),
    ).toMatchObject({ source: 'engine', stale: false })
  })

  it('the cached-value fallback over an engine error is flagged as cache with the engine result', () => {
    const state = lazyState({ formulaMode: true })
    expect(
      formulaProvenance(state, 'sheet-1', 0, 0, {
        formula: '=FOO(1)',
        modelHasFormula: true,
        value: 15,
        rawValue: '#NAME?',
      }),
    ).toMatchObject({ source: 'cache', engineResult: '#NAME?' })
  })

  it('plain values are not formulas', () => {
    expect(
      formulaProvenance(lazyState({}), 'sheet-1', 0, 0, {
        modelHasFormula: false,
        value: 1,
        rawValue: 1,
      }),
    ).toBeNull()
  })
})

function lazyCtx(state: LazyWorkbookState, cell: { f?: string; v: Scalar; display: Scalar }) {
  const range = {
    getValue: () => cell.display,
    getFormula: () => cell.f ?? '',
    getNumberFormat: () => 'General',
    getCellDatas: () => [[cell.f ? { f: cell.f, v: cell.v } : { v: cell.v }]],
  }
  const worksheet = { getSheetId: () => 'sheet-1', getRange: () => range }
  return {
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
    lazyWorkbookRef: { current: state },
    adapterRef: { current: { getSnapshot: () => ({ revision: 0, sheets: [] }) } },
  } as unknown as WorkbookReadContext
}

describe('g6-12 #22: readCells carries the flag in lazy mode', () => {
  it('reports the indexed formula and the cache source of a streamed cell', () => {
    const state = lazyState({ formulaText: { '1:0': '=SUM(A1)' }, editedCells: ['0:0'] })
    const cell = readCells(lazyCtx(state, { v: 7, display: 7 }), ['A2'])['A2']
    expect(cell).toMatchObject({ formula: '=SUM(A1)', valueSource: 'cache', staleCache: true })
  })

  it('marks engine-owned formulas as engine results', () => {
    const state = lazyState({ formulaMode: true })
    const cell = readCells(lazyCtx(state, { f: '=1+1', v: 2, display: 2 }), ['A1'])['A1']
    expect(cell).toMatchObject({ formula: '=1+1', valueSource: 'engine' })
    expect(cell?.staleCache).toBeFalsy()
  })
})

function toolDeps(overrides: Partial<SheetsSkillDeps>): SheetsSkillDeps {
  return {
    getActiveSheetInfo: () => ({
      mode: 'lazy',
      sheetId: 'sheet-1',
      sheetName: 'Data',
      knownAddresses: [],
      sheets: [{ id: 'sheet-1', name: 'Data' }],
    }),
    readCells: () => ({}),
    readFormats: () => ({}),
    readSheetFeatures: () => '',
    findCells: () => ({ matches: [], truncated: false, incompleteSheets: [] }),
    selectRange: () => ({ ok: true, sheetName: 'Data' }),
    tracePrecedents: () => ({ refs: [] }),
    traceDependents: () => ({ dependents: [], truncated: false, incompleteSheets: [] }),
    proposeOperations: () => ({ ok: false, error: 'not configured' }),
    ...overrides,
  }
}

describe('g6-12 #22: tools never present a stale cache as the answer', () => {
  const readCellsDep = vi.fn().mockReturnValue({
    A1: { value: 2, formula: '=1+1', valueSource: 'engine', type: 'number', rawValue: 2 },
    A2: {
      value: 7,
      formula: '=SUM(A1)',
      valueSource: 'cache',
      staleCache: false,
      type: 'number',
      rawValue: 7,
    },
    A3: {
      value: 9,
      formula: '=SUM(B1)',
      valueSource: 'cache',
      staleCache: true,
      type: 'number',
      rawValue: 9,
    },
  })

  it('read_cells labels cache values and replaces stale ones with "not recalculated"', async () => {
    const result = (await executeWorkbookTool(
      { id: 'c', name: 'read_cells', input: { addresses: ['A1', 'A2', 'A3'] } },
      toolDeps({ readCells: readCellsDep }),
    )) as ToolExecution
    const lines = result.output.split('\n')
    expect(lines[0]).toBe('A1: 2 (=1+1)')
    expect(lines[1]).toContain('A2: 7 (=SUM(A1))')
    expect(lines[1]).toContain('cached value from the file')
    expect(lines[2]).toMatch(/^A3: NOT RECALCULATED \(=SUM\(B1\)\)/)
    expect(lines[2]).not.toMatch(/^A3: 9/)
  })

  it('read_range shows NOT RECALCULATED in the grid for a stale cache', async () => {
    const result = (await executeWorkbookTool(
      { id: 'c', name: 'read_range', input: { range: 'A1:A3' } },
      toolDeps({ readCells: readCellsDep }),
    )) as ToolExecution
    const lines = result.output.split('\n')
    expect(lines[2]).toBe('1\t2 (=1+1)')
    expect(lines[4]).toBe('3\tNOT RECALCULATED (=SUM(B1))')
    expect(result.output).toContain('A2: cached value from the file')
  })

  it('aggregate_range withholds statistics built on stale cached formula values', async () => {
    const aggregateRange = vi.fn().mockResolvedValue({
      ok: true,
      aggregate: {
        cells: 3,
        nonEmpty: 3,
        distinct: 3,
        numericCount: 3,
        sum: 18,
        min: 2,
        max: 9,
        average: 6,
        topValues: [],
      },
      hiddenRows: 0,
      cachedFormulaCells: 2,
      staleCache: true,
    })
    const result = (await executeWorkbookTool(
      { id: 'c', name: 'aggregate_range', input: { range: 'A1:A3' } },
      toolDeps({ aggregateRange }),
    )) as ToolExecution
    expect(result.output).toContain('NOT RECALCULATED')
    expect(result.output).not.toContain('sum: 18')
  })

  it('aggregate_range labels fresh cached formula values', async () => {
    const aggregateRange = vi.fn().mockResolvedValue({
      ok: true,
      aggregate: {
        cells: 3,
        nonEmpty: 3,
        distinct: 3,
        numericCount: 3,
        sum: 18,
        min: 2,
        max: 9,
        average: 6,
        topValues: [],
      },
      hiddenRows: 0,
      cachedFormulaCells: 2,
      staleCache: false,
    })
    const result = (await executeWorkbookTool(
      { id: 'c', name: 'aggregate_range', input: { range: 'A1:A3' } },
      toolDeps({ aggregateRange }),
    )) as ToolExecution
    expect(result.output).toContain('sum: 18')
    expect(result.output).toContain('2 formula cells')
    expect(result.output).toContain('cached values from the file')
  })
})

describe('g6-12 #22: aggregateWorkbookRange counts cached formula cells', () => {
  function ctxFor(state: LazyWorkbookState): WorkbookReadContext {
    return {
      univerRef: { current: null },
      lazyWorkbookRef: { current: state },
      adapterRef: { current: { getSnapshot: () => ({ revision: 0, sheets: [] }) } },
    } as unknown as WorkbookReadContext
  }

  function stubSidecar() {
    vi.stubGlobal('window', {
      desktopApi: {
        readWorkbookRange: vi.fn().mockResolvedValue({
          cells: [
            { row: 0, column: 0, value: 1 },
            { row: 1, column: 0, value: 7, formula: 'SUM(A1)' },
            { row: 2, column: 0, value: 9 },
          ],
          rows: [],
          indexedThroughRow: Number.MAX_SAFE_INTEGER,
        }),
      },
    })
  }

  it('flags sidecar formula values as cached, stale after an edit', async () => {
    stubSidecar()
    const state = lazyState({ formulaText: { '2:0': '=A1*9' }, editedCells: ['0:0'] })
    const result = await aggregateWorkbookRange(ctxFor(state), 'sheet-1', parseRange('A1:A3'), {
      hiddenRows: 'include',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // A1 is a journal value (5), A2 a sidecar formula, A3 an indexed shared/plain-text formula
    expect(result.cachedFormulaCells).toBe(2)
    expect(result.staleCache).toBe(true)
  })

  it('is not stale when nothing was edited', async () => {
    stubSidecar()
    const state = lazyState({ formulaText: { '2:0': '=A1*9' } })
    const result = await aggregateWorkbookRange(ctxFor(state), 'sheet-1', parseRange('A1:A3'), {
      hiddenRows: 'include',
    })
    expect(result.ok && result.cachedFormulaCells).toBe(2)
    expect(result.ok && result.staleCache).toBe(false)
  })
})
