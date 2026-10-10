// UNI-1232 A2: which saves can change a value, and the worksheet rewrite that keeps stale cached
// values out of the file.
import { describe, expect, it } from 'vitest'
import type { WorkbookSaveRequest } from '../../../../apps/sheets/src/shared/desktop-api'
import {
  engineCanReplaySave,
  formulaCells,
  rewriteFormulaCachedValues,
  savedValuesMayChange,
  worksheetPartsByName,
} from './stale-values'

const save = (over: Record<string, unknown> = {}) =>
  ({
    edits: [],
    structuralOps: [],
    sheetOps: [],
    bulkConstantFills: [],
    pivotAdditions: [],
    pivotRefreshUpdates: [],
    pivotCacheRefreshPaths: [],
    definedNamesState: null,
    formulaValues: [],
    ...over,
  }) as unknown as WorkbookSaveRequest

describe('savedValuesMayChange', () => {
  it('is false for saves that cannot change a formula result', () => {
    expect(savedValuesMayChange(save())).toBe(false)
    // style-only edit
    expect(savedValuesMayChange(save({ edits: [{ writeValue: false }] }))).toBe(false)
    expect(
      savedValuesMayChange(
        save({
          structuralOps: [
            { kind: 'set-row-size' },
            { kind: 'set-col-style' },
            { kind: 'unmerge-cells' },
          ],
          sheetOps: [
            { kind: 'set-sheet-tab-color' },
            { kind: 'rename-sheet' },
            { kind: 'reorder-sheets' },
          ],
        }),
      ),
    ).toBe(false)
  })

  it('is true for edits, shifts, removals, fills, pivots and name changes', () => {
    expect(savedValuesMayChange(save({ edits: [{ writeValue: true }] }))).toBe(true)
    expect(savedValuesMayChange(save({ edits: [{ writeValue: false, formula: '=A1' }] }))).toBe(
      true,
    )
    for (const kind of [
      'insert-rows',
      'remove-cols',
      'move-rows',
      'merge-cells',
      'set-rows-hidden',
    ]) {
      expect(savedValuesMayChange(save({ structuralOps: [{ kind }] }))).toBe(true)
    }
    expect(savedValuesMayChange(save({ sheetOps: [{ kind: 'remove-sheet' }] }))).toBe(true)
    expect(savedValuesMayChange(save({ bulkConstantFills: [{}] }))).toBe(true)
    expect(savedValuesMayChange(save({ pivotAdditions: [{}] }))).toBe(true)
    expect(savedValuesMayChange(save({ definedNamesState: {} }))).toBe(true)
  })

  it('the engine replays plain edits only', () => {
    expect(engineCanReplaySave(save({ edits: [{ writeValue: true }] }))).toBe(true)
    expect(engineCanReplaySave(save({ sheetOps: [{ kind: 'set-sheet-tab-color' }] }))).toBe(true)
    expect(engineCanReplaySave(save({ structuralOps: [{ kind: 'insert-rows' }] }))).toBe(false)
    expect(engineCanReplaySave(save({ sheetOps: [{ kind: 'add-sheet' }] }))).toBe(false)
    expect(engineCanReplaySave(save({ pivotCacheRefreshPaths: ['x'] }))).toBe(false)
  })
})

describe('worksheetPartsByName', () => {
  it('maps sheet names (entities decoded) to their parts, whatever the attribute order', () => {
    const workbook =
      '<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet r:id="rId5" sheetId="2" name="A &amp; B"/></sheets></workbook>'
    const rels =
      '<Relationships><Relationship Target="worksheets/sheet1.xml" Id="rId1" Type="t"/><Relationship Id="rId5" Type="t" Target="/xl/worksheets/s2.xml"/></Relationships>'
    expect(worksheetPartsByName(workbook, rels)).toEqual(
      new Map([
        ['Data', 'xl/worksheets/sheet1.xml'],
        ['A & B', 'xl/worksheets/s2.xml'],
      ]),
    )
  })
})

const sheet = (cells: string) =>
  `<worksheet><cols><col min="1" max="1"/></cols><sheetData><row r="1">${cells}</row></sheetData></worksheet>`

describe('formulaCells', () => {
  it('lists every formula cell, shared followers included, and nothing else', () => {
    const xml = sheet(
      '<c r="A1"><v>1</v></c><c r="B1"><f>A1*2</f><v>2</v></c><c r="C1" s="2"/>' +
        '<c r="AA1"><f t="shared" si="0"/><v>5</v></c><c r="D1" t="inlineStr"><is><t>f</t></is></c>',
    )
    expect(formulaCells(xml)).toEqual([
      { row: 0, column: 1 },
      { row: 0, column: 26 },
    ])
  })
})

describe('rewriteFormulaCachedValues', () => {
  const xml = sheet(
    '<c r="A1" s="1"><v>1</v></c>' +
      '<c r="B1" s="3"><f>A1*2</f><v>2</v></c>' +
      '<c r="C1" t="str"><f>"x"&amp;A1</f><v>x1</v></c>' +
      '<c r="D1" t="e"><f>1/0</f><v>#DIV/0!</v></c>' +
      '<c r="E1"><f t="shared" si="0"/><v>9</v></c>',
  )

  it('removes every cached value (and its type) and keeps the formulas, constants and styles', () => {
    const out = rewriteFormulaCachedValues(xml)
    expect(out).toContain('<c r="A1" s="1"><v>1</v></c>')
    expect(out).toContain('<c r="B1" s="3"><f>A1*2</f></c>')
    expect(out).toContain('<c r="C1"><f>"x"&amp;A1</f></c>')
    expect(out).toContain('<c r="D1"><f>1/0</f></c>')
    expect(out).toContain('<c r="E1"><f t="shared" si="0"/></c>')
    expect(out).toContain('<cols><col min="1" max="1"/></cols>')
  })

  it('writes the given results with the right type, drops the cells it has none for', () => {
    const values = new Map<string, string | number | boolean | { error: string } | null>([
      ['0:1', 20],
      ['0:2', 'a<b'],
      ['0:3', { error: '#N/A' }],
    ])
    const out = rewriteFormulaCachedValues(xml, (row, column) => values.get(`${row}:${column}`))
    expect(out).toContain('<c r="B1" s="3"><f>A1*2</f><v>20</v></c>')
    expect(out).toContain('<c r="C1" t="str"><f>"x"&amp;A1</f><v>a&lt;b</v></c>')
    expect(out).toContain('<c r="D1" t="e"><f>1/0</f><v>#N/A</v></c>')
    expect(out).toContain('<c r="E1"><f t="shared" si="0"/></c>')
    const bool = rewriteFormulaCachedValues(sheet('<c r="A1"><f>1=1</f><v>0</v></c>'), () => true)
    expect(bool).toContain('<c r="A1" t="b"><f>1=1</f><v>1</v></c>')
  })

  it('returns the very same string when nothing changes', () => {
    const clean = sheet('<c r="A1"><v>1</v></c><c r="B1"><f>A1*2</f></c>')
    expect(rewriteFormulaCachedValues(clean)).toBe(clean)
    const same = sheet('<c r="B1"><f>A1*2</f><v>2</v></c>')
    expect(rewriteFormulaCachedValues(same, () => 2)).toBe(same)
  })
})
