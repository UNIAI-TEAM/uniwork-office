/**
 * The Spelling dialog's write path: Replace reports whether the live cell
 * really changed (a guard that cancels SetRangeValuesCommand leaves the cell
 * alone and the facade says nothing), and corrected text is written as exact
 * cell data so it is never re-parsed as a formula, number or date.
 */
import { describe, expect, it } from 'vitest'
import { applySpellReplacement, type SpellWorkbookLike } from '../src/renderer/spell-apply'
import type { SpellFinding } from '../src/renderer/spell-check'

type Cell = { v?: unknown; f?: unknown; p?: unknown }

/** A one-sheet workbook; `veto` models a guard cancelling the write. */
function fakeWorkbook(cell: Cell, veto: boolean) {
  const cellData: Record<string, Record<string, Cell>> = { 0: { 0: cell } }
  const writes: unknown[][][] = []
  const workbook: SpellWorkbookLike = {
    getSheets: () => [{ getSheetId: () => 's1', getSheetName: () => 'Data' }],
    getSnapshot: () => ({ sheets: { s1: { name: 'Data', cellData } } }),
    getSheetBySheetId: () => ({
      getRange: () => ({
        setValues: (values: unknown[][]) => {
          writes.push(values)
          if (!veto) cellData['0']!['0'] = values[0]![0] as Cell
        },
      }),
    }),
  }
  return { workbook, writes, cellData }
}

const finding = (text: string, word: string): SpellFinding => ({
  cell: { sheetId: 's1', sheetName: 'Data', address: 'A1', row: 0, column: 0, text },
  word,
  suggestions: ['the'],
})

describe('applySpellReplacement', () => {
  it('changes the cell and reports true when the write goes through', () => {
    const { workbook, cellData } = fakeWorkbook({ v: 'teh total' }, false)
    expect(applySpellReplacement(workbook, finding('teh total', 'teh'), 'the')).toBe(true)
    expect(cellData['0']!['0']!.v).toBe('the total')
  })

  it('reports false when a guard vetoes the write and the cell is unchanged', () => {
    const { workbook, writes, cellData } = fakeWorkbook({ v: 'teh total' }, true)
    expect(applySpellReplacement(workbook, finding('teh total', 'teh'), 'the')).toBe(false)
    expect(writes).toHaveLength(1)
    expect(cellData['0']!['0']!.v).toBe('teh total')
  })

  it('writes exact cell data so a corrected text starting with = stays text', () => {
    const { workbook, writes } = fakeWorkbook({ v: 'teh total' }, false)
    applySpellReplacement(workbook, finding('teh total', 'teh'), '=the')
    expect(writes[0]![0]![0]).toEqual({ v: '=the total', p: null, f: null })
  })

  it('reports false for a cell that no longer holds the word', () => {
    const { workbook, writes } = fakeWorkbook({ v: 'fine now' }, false)
    expect(applySpellReplacement(workbook, finding('teh total', 'teh'), 'the')).toBe(false)
    expect(writes).toHaveLength(0)
  })

  it('counts only the real changes across a Replace All style loop', () => {
    const open = fakeWorkbook({ v: 'teh one' }, false)
    const locked = fakeWorkbook({ v: 'teh two' }, true)
    const results = [
      applySpellReplacement(open.workbook, finding('teh one', 'teh'), 'the'),
      applySpellReplacement(locked.workbook, finding('teh two', 'teh'), 'the'),
    ]
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
