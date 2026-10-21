import { describe, expect, it } from 'vitest'
import {
  PICKER_COARSE_EXTRA,
  PICKER_COLUMNS,
  PICKER_EDITOR_RUNG,
  pickerColumnsFor,
  pickerEditorRungFor,
  pickerSublineOf,
  pickerTrackOf,
} from '../src/renderer/src/doclist/picker'

/**
 * UNI-2047 B2: the compact `picker` variant of the Documents list (Open dialog
 * and folder browser). Tên (+ second line) · Người sửa · Cập nhật: no Chọn, no
 * Truy cập, no Dung lượng, no Thao tác column (the row's buttons sit beside it).
 */
describe('picker columns', () => {
  it('is Tên, Người sửa gần nhất, Cập nhật and nothing else', () => {
    expect(PICKER_COLUMNS).toEqual(['name', 'editor', 'updated'])
    const forbidden = ['select', 'access', 'size', 'actions']
    for (const width of [undefined, 0, 300, 900]) {
      for (const column of pickerColumnsFor(width)) expect(forbidden).not.toContain(column)
    }
  })

  it('shows every column with no measurement yet, and at or above the rung', () => {
    expect(pickerColumnsFor(undefined)).toEqual(['name', 'editor', 'updated'])
    expect(pickerColumnsFor(Number.NaN)).toEqual(['name', 'editor', 'updated'])
    expect(pickerColumnsFor(PICKER_EDITOR_RUNG)).toEqual(['name', 'editor', 'updated'])
    expect(pickerColumnsFor(PICKER_EDITOR_RUNG + 400)).toEqual(['name', 'editor', 'updated'])
  })

  it('hides Người sửa first when the list narrows; Tên and Cập nhật never hide', () => {
    expect(pickerColumnsFor(PICKER_EDITOR_RUNG - 1)).toEqual(['name', 'updated'])
    expect(pickerColumnsFor(120)).toEqual(['name', 'updated'])
  })

  it('keeps the rung inside a 640px dialog with its folder tree beside the list', () => {
    // wide enough for Tên + Người sửa + Cập nhật + the row buttons, narrow enough to be reachable
    expect(PICKER_EDITOR_RUNG).toBeGreaterThanOrEqual(400)
    expect(PICKER_EDITOR_RUNG).toBeLessThanOrEqual(520)
  })

  it('lays the row on a grid with one track per column, Tên taking the rest', () => {
    // tracks are separated by a space that is not inside a minmax(...)
    const tracks = (columns: Parameters<typeof pickerTrackOf>[0]) =>
      pickerTrackOf(columns).split(/\s(?![^(]*\))/)
    expect(tracks(['name', 'editor', 'updated'])).toHaveLength(3)
    expect(tracks(['name', 'updated'])).toHaveLength(2)
    expect(tracks(['name', 'updated'])[0]).toMatch(/^minmax\(/)
    // Cập nhật is a fixed track so the dates line up from row to row
    expect(tracks(['name', 'updated'])[1]).toMatch(/^\d+px$/)
  })
})

// R-FE3 M2: the host's own buttons (Desk's pill / Resolve) take room the ladder must keep clear
describe('picker columns follow the reserve the host asks for', () => {
  const ALL = ['name', 'editor', 'updated']
  const TWO = ['name', 'updated']

  it('moves the rung up with the reserve and keeps the default one without it', () => {
    expect(pickerColumnsFor(PICKER_EDITOR_RUNG)).toEqual(ALL)
    expect(PICKER_EDITOR_RUNG).toBe(pickerEditorRungFor(76))
    expect(pickerEditorRungFor(128)).toBeGreaterThan(pickerEditorRungFor(76))
    expect(pickerEditorRungFor(232)).toBeGreaterThan(pickerEditorRungFor(128))
    expect(pickerEditorRungFor(44)).toBeLessThan(pickerEditorRungFor(76))
  })

  it('keeps Người sửa in a list wide enough for Tên floor + Người sửa + Cập nhật + the reserve', () => {
    // Tên 168 + Người sửa 112 + Cập nhật 116 + padding 16 = 412 + reserve
    for (const reserve of [44, 128, 232]) {
      const need = 412 + reserve
      expect(pickerColumnsFor(need - 1, reserve)).toEqual(TWO)
      expect(pickerColumnsFor(need + 16, reserve)).toEqual(ALL)
    }
  })

  it('pins the Desk widths: reserve 232 needs 656px, 128 needs 544px, the browser 44 needs 464px', () => {
    expect(pickerColumnsFor(640, 232)).toEqual(TWO)
    expect(pickerColumnsFor(656, 232)).toEqual(ALL)
    expect(pickerColumnsFor(528, 128)).toEqual(TWO)
    expect(pickerColumnsFor(544, 128)).toEqual(ALL)
    expect(pickerColumnsFor(448, 44)).toEqual(TWO)
    expect(pickerColumnsFor(464, 44)).toEqual(ALL)
  })

  it('counts the room a coarse pointer adds to the row buttons', () => {
    expect(PICKER_COARSE_EXTRA).toBe(28)
    const wide = pickerEditorRungFor(128)
    expect(pickerColumnsFor(wide, 128)).toEqual(ALL)
    expect(pickerColumnsFor(wide, 128 + PICKER_COARSE_EXTRA)).toEqual(TWO)
  })

  it('lets Tên shrink under its floor once Người sửa is gone, so a row never runs under the buttons', () => {
    const tracks = (columns: Parameters<typeof pickerTrackOf>[0]) =>
      pickerTrackOf(columns).split(/\s(?![^(]*\))/)
    const full = tracks(['name', 'editor', 'updated'])[0]!
    const two = tracks(['name', 'updated'])[0]!
    expect(full).toBe('minmax(168px, 1fr)')
    const floor = (track: string) => Number(/minmax\((\d+)px/.exec(track)![1])
    expect(floor(two)).toBeLessThan(floor(full))
    expect(floor(two)).toBeLessThanOrEqual(96)
  })
})

describe('picker second line', () => {
  const sub = (short: string, full = short, path?: boolean) => ({ short, full, path })

  it('leaves the second line as it is while Người sửa is a column', () => {
    expect(pickerSublineOf(sub('Legal'), 'Linh', true)).toEqual(sub('Legal'))
    expect(pickerSublineOf(null, 'Linh', true)).toBeNull()
  })

  it('names the editor under the title once the column is gone', () => {
    expect(pickerSublineOf(null, 'Linh', false)).toEqual({ short: 'Linh', full: 'Linh' })
    expect(pickerSublineOf(sub('Legal'), 'Linh', false)).toEqual({
      short: 'Legal · Linh',
      full: 'Legal · Linh',
    })
  })

  it('never adds the editor to a folder path, and never invents a name', () => {
    const path = sub('…/Contracts', 'Alpha / Contracts', true)
    expect(pickerSublineOf(path, 'Linh', false)).toEqual(path)
    expect(pickerSublineOf(null, null, false)).toBeNull()
    expect(pickerSublineOf(sub('Legal'), null, false)).toEqual(sub('Legal'))
  })
})
