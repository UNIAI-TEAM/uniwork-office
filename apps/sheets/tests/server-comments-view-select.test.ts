// @vitest-environment jsdom
/**
 * UNI-2020: the panel's reveal selects a cell on another sheet while the lazy workbook is still
 * streaming file content into that sheet. A streaming write wraps itself in `keepActiveSheet`,
 * which undoes any later flip TO the sheet it patched unless the flip is explicit navigation
 * (`focusWorksheet`). The view's select() is explicit navigation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { keepActiveSheet } from '../src/renderer/sheet-focus'
import { createUniverEditorView } from '../src/renderer/server-comments/univer-view'
import type { UniverRuntime } from '../src/renderer/univer-state'

vi.mock('../src/renderer/univer-sync', () => ({ revealCellBelowFreeze: () => Promise.resolve() }))

afterEach(() => vi.useRealTimers())

function fixture() {
  const sheets: Record<string, Record<string, unknown>> = {}
  let active: Record<string, unknown>
  const workbook = {
    getActiveSheet: () => active,
    setActiveSheet: (sheet: unknown) => {
      active = (typeof sheet === 'string' ? sheets[sheet] : sheet) as typeof active
    },
    getSheetBySheetId: (id: string) => sheets[id],
    getSheets: () => Object.values(sheets),
    getActiveRange: () => null,
  }
  for (const id of ['summary', 'data']) {
    sheets[id] = {
      getSheetId: () => id,
      getSheetName: () => id,
      getWorkbook: () => workbook,
      _fWorkbook: workbook,
      getRange: () => ({ activate: () => undefined }),
    }
  }
  active = sheets.summary!
  const view = createUniverEditorView(
    () => ({ univerAPI: { getActiveWorkbook: () => workbook } }) as unknown as UniverRuntime,
    () => null,
  )
  return { sheets, workbook, view }
}

describe('view.select vs a background load of the target sheet', () => {
  it('keeps the revealed sheet active when a keepActiveSheet restore for it is still pending', async () => {
    vi.useFakeTimers()
    const { sheets, workbook, view } = fixture()
    // the background load started while `summary` was active and patches `data`
    keepActiveSheet(sheets.data as never, () => undefined)
    view.select('data', { startRow: 6, endRow: 6, startColumn: 1, endColumn: 1 })
    expect(workbook.getActiveSheet()).toBe(sheets.data)
    await vi.runAllTimersAsync()
    expect(workbook.getActiveSheet()).toBe(sheets.data)
  })
})
