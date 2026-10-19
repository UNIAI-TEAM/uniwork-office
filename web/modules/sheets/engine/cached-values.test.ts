// UNI-1989: a save must not lose, change or invent the cached value of a formula the save did not
// touch (the engine's errors are only trusted where the file did not already hold the answer).
import { describe, expect, it } from 'vitest'
import type { WorkbookSaveRequest } from '../../../../apps/sheets/src/shared/desktop-api'
import { planRefresh, refreshFormulaValues } from './cached-values'
import {
  KEEP,
  formulaCellsWithValues,
  rewriteFormulaCachedValues,
  type CachedEntry,
  type CachedValue,
} from './stale-values'

const NAMES = new Map([
  ['s1', 'Q1'],
  ['s2', 'Doanh thu Q2'],
  ['s3', 'Tổng hợp'],
  ['s4', 'Ghi chú'],
])

const request = (edits: unknown[]) =>
  ({
    edits,
    structuralOps: [],
    sheetOps: [],
    bulkConstantFills: [],
    pivotAdditions: [],
    pivotRefreshUpdates: [],
    pivotCacheRefreshPaths: [],
    definedNamesState: null,
    formulaValues: [],
  }) as unknown as WorkbookSaveRequest

/** a plain constant typed on another sheet: the only change of the save */
const noteEdit = { sheetId: 's4', row: 0, column: 1, writeValue: true, value: 'note' }
const constantEdit = (sheetId: string, row: number, column: number, value: number) => ({
  sheetId,
  row,
  column,
  writeValue: true,
  value,
})
const typedEdit = (sheetId: string, row: number, column: number, formula: string) => ({
  sheetId,
  row,
  column,
  writeValue: true,
  value: 0,
  formula,
})

interface Formula {
  sheet: string
  row: number
  column: number
  original?: CachedValue
}
interface Answer {
  sheet: string
  row: number
  column: number
  formatted: string
  number?: number
  isError?: boolean
  isFormula?: boolean
}

const answer = (sheet: string, row: number, column: number, over: Partial<Answer>) => ({
  sheet,
  row,
  column,
  formatted: '',
  isFormula: true,
  ...over,
})

/** the refresh a save with `edits` runs over `formulas` (the file's formula cells), as the transport does */
function refresh(formulas: Formula[], answers: Answer[], edits: unknown[] = [noteEdit]) {
  const fileFormulas = new Map<string, { row: number; column: number; original?: CachedValue }[]>()
  for (const { sheet, ...cell } of formulas) {
    fileFormulas.set(sheet, [...(fileFormulas.get(sheet) ?? []), cell])
  }
  const plan = planRefresh(request(edits), NAMES, 100, fileFormulas)
  if (!plan) throw new Error('the save should be refreshable')
  return refreshFormulaValues(plan, answers as never, NAMES)
}
const valuesOf = (formulas: Formula[], answers: Answer[], edits?: unknown[]) =>
  refresh(formulas, answers, edits).map((entry) => entry.value)

describe('an untouched formula (UNI-1989)', () => {
  it('keeps its error, on the edited sheet and on another sheet', () => {
    const formulas: Formula[] = [
      { sheet: 'Doanh thu Q2', row: 1, column: 8, original: { error: '#N/A' } },
      { sheet: 'Doanh thu Q2', row: 4, column: 7, original: { error: '#DIV/0!' } },
      { sheet: 'Tổng hợp', row: 6, column: 1, original: { error: '#REF!' } },
    ]
    expect(
      valuesOf(formulas, [
        answer('Doanh thu Q2', 1, 8, { formatted: '#N/A', isError: true }),
        answer('Doanh thu Q2', 4, 7, { formatted: '#DIV/0!', isError: true }),
        answer('Tổng hợp', 6, 1, { formatted: '#REF!', isError: true }),
      ]),
    ).toEqual([KEEP, KEEP, KEEP])
  })

  it('keeps its error when the engine omits the cell or reports #ERROR!', () => {
    const formulas: Formula[] = [
      { sheet: 'Doanh thu Q2', row: 1, column: 8, original: { error: '#N/A' } },
      { sheet: 'Doanh thu Q2', row: 2, column: 8, original: { error: '#VALUE!' } },
      { sheet: 'Doanh thu Q2', row: 3, column: 8, original: { error: '#NAME?' } },
    ]
    expect(
      valuesOf(formulas, [
        // row 1: no answer at all
        answer('Doanh thu Q2', 2, 8, { formatted: '#ERROR!', isError: true }),
        answer('Doanh thu Q2', 3, 8, { formatted: '1', number: 1, isFormula: false }),
      ]),
    ).toEqual([KEEP, KEEP, KEEP])
  })

  it('keeps its error whatever error the engine now reports', () => {
    expect(
      valuesOf(
        [{ sheet: 'Tổng hợp', row: 0, column: 0, original: { error: '#N/A' } }],
        [answer('Tổng hợp', 0, 0, { formatted: '#NAME?', isError: true })],
      ),
    ).toEqual([KEEP])
  })

  it('keeps its number when the engine only drifts by float noise (<= 1e-12 relative)', () => {
    expect(
      valuesOf(
        [{ sheet: 'Tổng hợp', row: 4, column: 4, original: 1 }],
        [answer('Tổng hợp', 4, 4, { formatted: '1', number: 0.9999999999999999 })],
      ),
    ).toEqual([KEEP])
    expect(
      valuesOf(
        [{ sheet: 'Tổng hợp', row: 4, column: 4, original: 1 }],
        [answer('Tổng hợp', 4, 4, { formatted: '1.0001', number: 1.0001 })],
      ),
    ).toEqual([1.0001])
  })

  it('keeps a date serial (a date formula keeps its bytes)', () => {
    expect(
      valuesOf(
        [{ sheet: 'Tổng hợp', row: 0, column: 2, original: 45000 }],
        [answer('Tổng hợp', 0, 2, { formatted: '2023-03-15', number: 45000 })],
      ),
    ).toEqual([KEEP])
  })

  it('writes a trusted error as an error when the file did not hold one (a new dependent error)', () => {
    const formulas: Formula[] = [
      { sheet: 'Tổng hợp', row: 8, column: 2, original: 5 },
      { sheet: 'Tổng hợp', row: 9, column: 2, original: 5 },
    ]
    expect(
      valuesOf(formulas, [
        answer('Tổng hợp', 8, 2, { formatted: '#DIV/0!', isError: true }),
        answer('Tổng hợp', 9, 2, { formatted: '#N/A', isError: true }),
      ]),
    ).toEqual([{ error: '#DIV/0!' }, { error: '#N/A' }])
  })

  it('drops the value when the engine reports an error it cannot be trusted with, or no answer', () => {
    const formulas: Formula[] = ['#NAME?', '#N/IMPL!', '#ERROR!', '#SPILL!'].map((_, row) => ({
      sheet: 'Tổng hợp',
      row,
      column: 0,
      original: 5,
    }))
    formulas.push(
      { sheet: 'Tổng hợp', row: 4, column: 0, original: 5 },
      { sheet: 'Tổng hợp', row: 5, column: 0, original: 5 },
    )
    expect(
      valuesOf(formulas, [
        answer('Tổng hợp', 0, 0, { formatted: '#NAME?', isError: true }),
        answer('Tổng hợp', 1, 0, { formatted: '#N/IMPL!', isError: true }),
        answer('Tổng hợp', 2, 0, { formatted: '#ERROR!', isError: true }),
        answer('Tổng hợp', 3, 0, { formatted: '#SPILL!', isError: true }),
        // row 4: omitted; row 5: not a formula for the engine
        answer('Tổng hợp', 5, 0, { formatted: '5', number: 5, isFormula: false }),
      ]),
    ).toEqual([null, null, null, null, null, null])
  })

  it('gets the engine value when the file holds none (SH3)', () => {
    expect(
      valuesOf(
        [{ sheet: 'Tổng hợp', row: 0, column: 0 }],
        [answer('Tổng hợp', 0, 0, { formatted: '7', number: 7 })],
      ),
    ).toEqual([7])
  })

  it('is written when its value really changed', () => {
    expect(
      valuesOf(
        [{ sheet: 'Tổng hợp', row: 0, column: 0, original: 5 }],
        [answer('Tổng hợp', 0, 0, { formatted: '6', number: 6 })],
      ),
    ).toEqual([6])
  })

  it('keeps an unchanged boolean and types a flipped one as a boolean', () => {
    const formulas: Formula[] = [
      { sheet: 'Tổng hợp', row: 0, column: 0, original: true },
      { sheet: 'Tổng hợp', row: 1, column: 0, original: true },
      { sheet: 'Tổng hợp', row: 2, column: 0, original: false },
    ]
    expect(
      valuesOf(formulas, [
        answer('Tổng hợp', 0, 0, { formatted: 'TRUE' }),
        answer('Tổng hợp', 1, 0, { formatted: 'FALSE' }),
        answer('Tổng hợp', 2, 0, { formatted: 'TRUE' }),
      ]),
    ).toEqual([KEEP, false, true])
  })

  it('keeps unchanged text and writes changed text', () => {
    const formulas: Formula[] = [
      { sheet: 'Tổng hợp', row: 0, column: 0, original: 'x1' },
      { sheet: 'Tổng hợp', row: 1, column: 0, original: 'x1' },
    ]
    expect(
      valuesOf(formulas, [
        answer('Tổng hợp', 0, 0, { formatted: 'x1' }),
        answer('Tổng hợp', 1, 0, { formatted: 'x2' }),
      ]),
    ).toEqual([KEEP, 'x2'])
  })
})

describe('a formula the user typed (UNI-1989)', () => {
  const typed = [typedEdit('s3', 0, 0, '=1+2')]
  const formulas: Formula[] = [
    { sheet: 'Tổng hợp', row: 0, column: 0, original: { error: '#N/A' } },
  ]

  it('is written even when the file held an error', () => {
    expect(
      valuesOf(formulas, [answer('Tổng hợp', 0, 0, { formatted: '3', number: 3 })], typed),
    ).toEqual([3])
    expect(
      valuesOf(
        formulas,
        [answer('Tổng hợp', 0, 0, { formatted: '#DIV/0!', isError: true })],
        typed,
      ),
    ).toEqual([{ error: '#DIV/0!' }])
  })

  it('has no entry when the engine could not answer', () => {
    expect(refresh(formulas, [], typed)).toEqual([])
  })
})

describe('a save that edits a constant on another sheet (UNI-1989)', () => {
  const ws = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`
  const q2 = ws(
    '<row r="2"><c r="A2"><v>5</v></c>' +
      `<c r="I2" t="e"><f>VLOOKUP(A2,'Q1'!$A$2:$G$7,7,FALSE)</f><v>#N/A</v></c>` +
      '<c r="J2"><f>A2*2</f><v>10</v></c></row>' +
      '<row r="5"><c r="H5" t="e"><f>G5/D5</f><v>#DIV/0!</v></c></row>',
  )
  const total = ws(
    '<row r="5"><c r="E5" s="4"><f>SUM(E2:E4)</f><v>1</v></c></row>' +
      '<row r="7"><c r="B7" t="e"><f>#REF!</f><v>#REF!</v></c></row>' +
      '<row r="9"><c r="D9"><v>2</v></c><c r="C9"><f>10/D9</f><v>5</v></c></row>',
  )
  const sheets = { 'Doanh thu Q2': q2, 'Tổng hợp': total }
  const idOf = (name: string) => [...NAMES].find(([, n]) => n === name)![0]

  /** the save pipeline of cachedValuesFor: originals -> refresh -> rewrite of every sheet part */
  function save(edits: unknown[], answers: Answer[]) {
    const fileFormulas = new Map(
      Object.entries(sheets).map(([name, xml]) => [name, formulaCellsWithValues(xml)]),
    )
    const plan = planRefresh(request(edits), NAMES, 100, fileFormulas)!
    const values = refreshFormulaValues(plan, answers as never, NAMES)
    return Object.fromEntries(
      Object.entries(sheets).map(([name, xml]) => {
        const mine = new Map<string, CachedEntry>(
          values
            .filter((v) => v.sheetId === idOf(name))
            .map((v) => [`${v.row}:${v.column}`, v.value]),
        )
        return [name, rewriteFormulaCachedValues(xml, (row, col) => mine.get(`${row}:${col}`))]
      }),
    )
  }
  const untouchedAnswers = [
    answer('Doanh thu Q2', 1, 8, { formatted: '#N/A', isError: true }),
    answer('Doanh thu Q2', 4, 7, { formatted: '#DIV/0!', isError: true }),
    answer('Doanh thu Q2', 1, 9, { formatted: '10', number: 10 }),
    answer('Tổng hợp', 4, 4, { formatted: '1', number: 0.9999999999999999 }),
    answer('Tổng hợp', 6, 1, { formatted: '#REF!', isError: true }),
  ]

  it('leaves every untouched error and number byte-identical', () => {
    const out = save(
      [noteEdit],
      [...untouchedAnswers, answer('Tổng hợp', 8, 2, { formatted: '5', number: 5 })],
    )
    expect(out['Doanh thu Q2']).toBe(q2)
    expect(out['Tổng hợp']).toBe(total)
  })

  it('writes a new dependent error and nothing else once a precedent is zeroed', () => {
    const out = save(
      [constantEdit('s3', 8, 3, 0)],
      [...untouchedAnswers, answer('Tổng hợp', 8, 2, { formatted: '#DIV/0!', isError: true })],
    )
    expect(out['Doanh thu Q2']).toBe(q2)
    expect(out['Tổng hợp']).toContain('<c r="C9" t="e"><f>10/D9</f><v>#DIV/0!</v></c>')
    expect(out['Tổng hợp']).toContain('<c r="E5" s="4"><f>SUM(E2:E4)</f><v>1</v></c>')
    expect(out['Tổng hợp']).toContain('<c r="B7" t="e"><f>#REF!</f><v>#REF!</v></c>')
  })
})
