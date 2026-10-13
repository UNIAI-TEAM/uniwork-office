/**
 * G8-13 (UNI-1408): server comment anchors in a workbook (addendum §4.3, contract-collab §4.1).
 * Card test lines: insert a row above a commented cell then Save -> the anchor moves down and goes
 * out with the new version id; delete the range -> `lost`. Plus the range rules the card adds:
 * a range partly deleted shrinks, cut/paste carries it, a removed sheet loses it, a rename keeps it.
 */
import { describe, expect, it } from 'vitest'

import {
  createSheetsAnchorAdapter,
  type SheetsEditorView,
} from '../src/renderer/server-comments/adapter'
import {
  ServerAnchorStore,
  encodeXlsxAnchor,
  locateXlsxAnchor,
  shiftRange,
  type LiveSheet,
} from '../src/renderer/server-comments/anchor-store'
import { buildAnchorUpdates } from '../src/renderer/server-comments/anchor-sync'
import type { CellRange } from '../src/renderer/threaded-comments'

const SHEETS: LiveSheet[] = [
  { id: 'sheet-1', name: 'Summary', stableId: 'sheet-1' },
  { id: 'sheet-2', name: 'Data', stableId: 'sheet-2' },
]

const cell = (row: number, column: number): CellRange => ({
  startRow: row,
  endRow: row,
  startColumn: column,
  endColumn: column,
})

function rootAt(id: string, sheet: string, range: string, state = 'exact') {
  return { id, anchor: { format: 'xlsx', v: 1, sheet, range }, anchor_state: state }
}

describe('xlsx anchor codec', () => {
  it('encodes the stable sheet id when the sheet has one, else its name', () => {
    expect(encodeXlsxAnchor(SHEETS[1]!, cell(6, 1))).toEqual({
      format: 'xlsx',
      v: 1,
      sheet: 'sheet-2',
      range: 'B7',
    })
    const added: LiveSheet = { id: 'u-123', name: 'New sheet' }
    expect(
      encodeXlsxAnchor(added, { startRow: 6, endRow: 8, startColumn: 1, endColumn: 3 }),
    ).toEqual({ format: 'xlsx', v: 1, sheet: 'New sheet', range: 'B7:D9' })
  })

  it('locates by stable id first, then by name; anything else is not located', () => {
    expect(
      locateXlsxAnchor(SHEETS, { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B7' }),
    ).toEqual({ sheetId: 'sheet-2', range: cell(6, 1) })
    expect(
      locateXlsxAnchor(SHEETS, { format: 'xlsx', v: 1, sheet: 'Data', range: '$B$7' }),
    ).toEqual({ sheetId: 'sheet-2', range: cell(6, 1) })
    expect(
      locateXlsxAnchor(SHEETS, { format: 'xlsx', v: 1, sheet: 'Gone', range: 'B7' }),
    ).toBeNull()
    expect(
      locateXlsxAnchor(SHEETS, { format: 'xlsx', v: 1, sheet: 'Data', range: '7B' }),
    ).toBeNull()
    expect(locateXlsxAnchor(SHEETS, { format: 'docx', v: 1, path: [0] })).toBeNull()
  })
})

describe('range shift through structural edits', () => {
  const range = { startRow: 4, endRow: 7, startColumn: 1, endColumn: 2 } // B5:C8

  it('inserts above move it, inserts inside grow it, inserts below leave it', () => {
    expect(shiftRange(range, { kind: 'insert-rows', index: 0, count: 2 })).toEqual({
      ...range,
      startRow: 6,
      endRow: 9,
    })
    expect(shiftRange(range, { kind: 'insert-rows', index: 6, count: 1 })).toEqual({
      ...range,
      endRow: 8,
    })
    expect(shiftRange(range, { kind: 'insert-rows', index: 9, count: 1 })).toBe(range)
    expect(shiftRange(range, { kind: 'insert-cols', index: 0, count: 1 })).toEqual({
      ...range,
      startColumn: 2,
      endColumn: 3,
    })
  })

  it('a range partly deleted shrinks, fully deleted is lost', () => {
    expect(shiftRange(range, { kind: 'remove-rows', index: 3, count: 2 })).toEqual({
      ...range,
      startRow: 3,
      endRow: 5,
    })
    expect(shiftRange(range, { kind: 'remove-rows', index: 6, count: 5 })).toEqual({
      ...range,
      endRow: 5,
    })
    expect(shiftRange(range, { kind: 'remove-rows', index: 4, count: 4 })).toBeNull()
    expect(shiftRange(range, { kind: 'remove-cols', index: 0, count: 3 })).toBeNull()
    expect(shiftRange(range, { kind: 'remove-cols', index: 2, count: 1 })).toEqual({
      ...range,
      endColumn: 1,
    })
  })

  it('whole-row moves carry it like the thread store carries a thread', () => {
    expect(shiftRange(cell(4, 1), { kind: 'move-rows', index: 4, count: 1, before: 0 })).toEqual(
      cell(0, 1),
    )
    expect(shiftRange(cell(1, 1), { kind: 'move-rows', index: 4, count: 1, before: 0 })).toEqual(
      cell(2, 1),
    )
  })
})

describe('ServerAnchorStore + the anchor map after Save', () => {
  it('insert a row above a commented cell, then Save -> B8 goes out as exact', () => {
    const store = new ServerAnchorStore()
    const roots = [rootAt('c1', 'sheet-2', 'B7')]
    store.track(roots, SHEETS)
    store.applyStructuralOp('sheet-2', { kind: 'insert-rows', index: 2, count: 1 })
    expect(buildAnchorUpdates(store, roots, SHEETS)).toEqual([
      {
        comment_id: 'c1',
        anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B8' },
        state: 'exact',
      },
    ])
  })

  it('delete the range -> lost, with the last anchor the server knows', () => {
    const store = new ServerAnchorStore()
    const roots = [rootAt('c1', 'sheet-2', 'B7:C8'), rootAt('c2', 'sheet-1', 'A1')]
    store.track(roots, SHEETS)
    store.applyStructuralOp('sheet-2', { kind: 'remove-rows', index: 6, count: 2 })
    expect(buildAnchorUpdates(store, roots, SHEETS)).toEqual([
      { comment_id: 'c1', anchor: roots[0]!.anchor, state: 'lost' },
      {
        comment_id: 'c2',
        anchor: { format: 'xlsx', v: 1, sheet: 'sheet-1', range: 'A1' },
        state: 'exact',
      },
    ])
  })

  it('edits on another sheet leave the anchor where it is', () => {
    const store = new ServerAnchorStore()
    const roots = [rootAt('c1', 'sheet-2', 'B7')]
    store.track(roots, SHEETS)
    store.applyStructuralOp('sheet-1', { kind: 'remove-rows', index: 0, count: 20 })
    expect(store.locationOf('c1')).toEqual({ sheetId: 'sheet-2', range: cell(6, 1) })
  })

  it('cut/paste carries a range wholly inside the source, even to another sheet', () => {
    const store = new ServerAnchorStore()
    store.track([rootAt('c1', 'sheet-2', 'B7'), rootAt('c2', 'sheet-2', 'B7:Z9')], SHEETS)
    store.moveRange(
      'sheet-2',
      { startRow: 5, endRow: 7, startColumn: 0, endColumn: 3 },
      'sheet-1',
      { startRow: 0, endRow: 2, startColumn: 4, endColumn: 7 },
    )
    expect(store.locationOf('c1')).toEqual({ sheetId: 'sheet-1', range: cell(1, 5) })
    expect(store.locationOf('c2')?.sheetId).toBe('sheet-2')
  })

  it('a removed sheet loses its anchors; a server-lost comment is never relocated', () => {
    const store = new ServerAnchorStore()
    store.track([rootAt('c1', 'sheet-2', 'B7'), rootAt('c2', 'sheet-1', 'A1', 'lost')], SHEETS)
    expect(store.locationOf('c2')).toBeNull()
    store.removeSheet('sheet-2')
    expect(store.locationOf('c1')).toBeNull()
  })

  it('a renamed sheet keeps its anchors (the live id is kept; the stable id is encoded)', () => {
    const store = new ServerAnchorStore()
    const roots = [rootAt('c1', 'sheet-2', 'B7')]
    store.track(roots, SHEETS)
    const renamed = [SHEETS[0]!, { ...SHEETS[1]!, name: 'Raw data' }]
    expect(buildAnchorUpdates(store, roots, renamed)[0]).toMatchObject({
      state: 'exact',
      anchor: { sheet: 'sheet-2', range: 'B7' },
    })
  })

  it('the reopen after a Save rebases live sheet ids by name', () => {
    const store = new ServerAnchorStore()
    const before = [...SHEETS, { id: 'u-9', name: 'Added' }]
    store.track([rootAt('c1', 'Added', 'C3')], before)
    store.rebase(new Map(before.map((s) => [s.id, s.name])), [
      ...SHEETS,
      { id: 'sheet-3', name: 'Added' },
    ])
    expect(store.locationOf('c1')).toEqual({ sheetId: 'sheet-3', range: cell(2, 2) })
  })

  it('reset forgets every location (another workbook opened)', () => {
    const store = new ServerAnchorStore()
    store.track([rootAt('c1', 'sheet-2', 'B7')], SHEETS)
    store.reset()
    expect(store.locationOf('c1')).toBeUndefined()
  })

  it('marks the first cell of a located range only (display-only marker)', () => {
    const store = new ServerAnchorStore()
    store.track([rootAt('c1', 'sheet-2', 'B7:C8')], SHEETS)
    expect(store.hasMarker('sheet-2', 6, 1)).toBe(true)
    expect(store.hasMarker('sheet-2', 7, 2)).toBe(false)
    expect(store.hasMarker('sheet-1', 6, 1)).toBe(false)
  })
})

describe('the kit anchor adapter', () => {
  function setup() {
    const store = new ServerAnchorStore()
    const roots = [rootAt('c1', 'sheet-2', 'B7'), rootAt('c2', 'sheet-1', 'C3')]
    store.track(roots, SHEETS)
    const selected: Array<[string, CellRange]> = []
    const view: SheetsEditorView = {
      sheets: () => SHEETS,
      activeSheetId: () => 'sheet-1',
      selection: () => null,
      select: (sheetId, range) => selected.push([sheetId, range]),
    }
    return { store, roots, selected, adapter: createSheetsAnchorAdapter(store, view) }
  }

  it('orders by sheet order, then row, then column', () => {
    const { adapter, roots } = setup()
    const b7 = adapter.order(roots[0]!.anchor) as number
    const c3 = adapter.order(roots[1]!.anchor) as number
    expect(c3).toBeLessThan(b7)
  })

  it('locates and goes to the live place, not the stale server anchor', () => {
    const { store, adapter, roots, selected } = setup()
    store.applyStructuralOp('sheet-2', { kind: 'insert-rows', index: 0, count: 1 })
    expect(adapter.locate(roots[0]!.anchor)).toBe(true)
    adapter.goTo(roots[0]!.anchor)
    expect(selected).toEqual([['sheet-2', cell(7, 1)]])
    store.applyStructuralOp('sheet-2', { kind: 'remove-rows', index: 7, count: 1 })
    expect(adapter.locate(roots[0]!.anchor)).toBe(false)
  })

  it('names the active sheet and resolves stable ids to names for labels', () => {
    const { adapter } = setup()
    expect(adapter.activeSheet?.()).toBe('Summary')
    expect(adapter.sheetName?.('sheet-2')).toBe('Data')
    // V13-3: a stable id the workbook never had labels as the bare cell (the active sheet's name)
    expect(adapter.sheetName?.('sheet-9')).toBe('Summary')
  })
})

describe('not located yet is not lost (FE13-3)', () => {
  it('a list that lands before the workbook has sheets stays untracked, then locates', () => {
    const store = new ServerAnchorStore()
    const roots = [rootAt('c1', 'sheet-2', 'B7')]
    store.track(roots, [])
    expect(store.locationOf('c1')).toBeUndefined()
    // the next Save still encodes it from the live sheets, not as lost
    expect(buildAnchorUpdates(store, roots, SHEETS)).toEqual([
      {
        comment_id: 'c1',
        anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B7' },
        state: 'exact',
      },
    ])
    store.track(roots, SHEETS)
    expect(store.locationOf('c1')).toEqual({ sheetId: 'sheet-2', range: cell(6, 1) })
  })

  it('a sheet the loaded workbook does not have is lost; a server-lost one stays lost', () => {
    const store = new ServerAnchorStore()
    store.track([rootAt('c1', 'sheet-9', 'A1'), rootAt('c2', 'sheet-2', 'B7', 'lost')], SHEETS)
    expect(store.locationOf('c1')).toBeNull()
    expect(store.locationOf('c2')).toBeNull()
  })

  it('the adapter names a sheet that went away by its last known name', () => {
    const store = new ServerAnchorStore()
    store.track([rootAt('c1', 'sheet-2', 'B7')], SHEETS)
    const live = SHEETS.filter((s) => s.id !== 'sheet-2')
    const adapter = createSheetsAnchorAdapter(store, {
      sheets: () => live,
      activeSheetId: () => 'sheet-1',
      selection: () => null,
      select: () => undefined,
    })
    expect(adapter.sheetName!('sheet-2')).toBe('Data')
    // never seen: the active sheet's name, so the label is the bare cell
    expect(adapter.sheetName!('sheet-9')).toBe('Summary')
    // a session sheet keyed by its name keeps that name
    expect(adapter.sheetName!('Added')).toBe('Added')
    store.reset()
    expect(adapter.sheetName!('sheet-2')).toBe('Summary')
  })
})
