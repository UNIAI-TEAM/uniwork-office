import { describe, expect, it } from 'vitest'
import {
  columnsFor,
  COLUMN_LABEL_KEY,
  defaultSort,
  DOC_LIST_SCREENS,
  isSortable,
  nextSort,
  specialColumn,
  sortRows,
  type ColumnId,
  type DocListScreen,
} from '../src/renderer/src/doclist/columns'
import { docListText } from '../src/renderer/src/doclist/text'

const WIDE = 2000

describe('column order (Chọn · Tên · [đặc trưng] · Truy cập · Người sửa · Cập nhật · Dung lượng · Thao tác)', () => {
  const SPECIAL: Record<string, string | null> = {
    workspace: null,
    recent: 'activity',
    starred: 'starred',
    shared: 'shared',
    'shared-by-me': 'shared_with',
    shelved: 'shelved',
    trash: 'deleted',
  }

  it.each(Object.entries(SPECIAL))('%s', (screen, special) => {
    const expected = [
      'select',
      'name',
      ...(special ? [special] : []),
      'access',
      'editor',
      'updated',
      'size',
      'actions',
    ]
    expect(columnsFor(screen as DocListScreen, WIDE)).toEqual(expected)
    expect(specialColumn(screen as DocListScreen)).toBe(special)
  })

  it('the local device list has no access, editor or special column', () => {
    expect(columnsFor('device', WIDE)).toEqual(['select', 'name', 'updated', 'size', 'actions'])
  })

  it('knows the 7 UniWork screens, Từ nơi khác (UNI-2047 B4) and the device list', () => {
    expect([...DOC_LIST_SCREENS]).toEqual([
      'workspace',
      'recent',
      'starred',
      'shared',
      'shared-by-me',
      'shelved',
      'trash',
      'elsewhere',
      'device',
    ])
  })

  // A-FIX4 m3: Trash and Lưu trữ draw a 176px actions track (a button before the …), 100px more
  // than the others, so every rung is 100px further out or the row overflows the table
  it('narrows Trash and Lưu trữ with their wide actions track in mind', () => {
    for (const screen of ['trash', 'shelved'] as const) {
      expect(columnsFor(screen, 751)).not.toContain('access')
      expect(columnsFor(screen, 752)).toContain('access')
      expect(columnsFor(screen, 879)).not.toContain('editor')
      expect(columnsFor(screen, 880)).toContain('editor')
      expect(columnsFor(screen, 975)).not.toContain('size')
      expect(columnsFor(screen, 976)).toContain('size')
    }
    // a screen with the 76px actions track keeps its rungs
    expect(columnsFor('recent', 655)).not.toContain('access')
    expect(columnsFor('recent', 656)).toContain('access')
  })

  it('no width means the full table', () => {
    expect(columnsFor('workspace')).toEqual(columnsFor('workspace', WIDE))
  })

  it('every column has a label key in the shard', () => {
    const t = docListText('en')
    for (const screen of DOC_LIST_SCREENS) {
      for (const col of columnsFor(screen, WIDE)) expect(t(COLUMN_LABEL_KEY[col])).not.toBe('')
    }
  })
})

describe('the narrow ladder hides Dung lượng, then Người sửa, then Truy cập', () => {
  it('walks the ladder on the workspace screen as the table narrows (34 / 42 / 47 rem)', () => {
    const at = (w: number) => columnsFor('workspace', w)
    expect(at(1400)).toContain('size')
    expect(at(752)).toContain('size')
    expect(at(751)).not.toContain('size')
    expect(at(751)).toContain('editor')
    expect(at(672)).toContain('editor')
    expect(at(671)).not.toContain('editor')
    expect(at(671)).toContain('access')
    expect(at(544)).toContain('access')
    expect(at(543)).not.toContain('access')
  })

  it('never hides Chọn, Tên, the screen column, Cập nhật or Thao tác', () => {
    for (const screen of DOC_LIST_SCREENS.filter((s) => s !== 'device')) {
      const cols = columnsFor(screen, 0)
      // Từ nơi khác files cannot be selected: that page has no Chọn column
      const keeps: ColumnId[] =
        screen === 'elsewhere'
          ? ['name', 'updated', 'actions']
          : ['select', 'name', 'updated', 'actions']
      for (const keep of keeps) {
        expect(cols).toContain(keep)
      }
      const special = specialColumn(screen)
      if (special) expect(cols).toContain(special)
    }
  })

  it('a screen with a screen column needs a wider table for each column (41 / 49 / 54 rem)', () => {
    expect(columnsFor('workspace', 752)).toContain('size')
    expect(columnsFor('recent', 752)).not.toContain('size')
    expect(columnsFor('recent', 864)).toContain('size')
    expect(columnsFor('recent', 863)).not.toContain('size')
    expect(columnsFor('recent', 784)).toContain('editor')
    expect(columnsFor('recent', 783)).not.toContain('editor')
    expect(columnsFor('recent', 656)).toContain('access')
    expect(columnsFor('recent', 655)).not.toContain('access')
  })

  // Trash and Lưu trữ have their own, 100px wider rungs (A-FIX4 m3, pinned above)
  const ON_76PX_ACTIONS = DOC_LIST_SCREENS.filter(
    (s) => s !== 'device' && s !== 'trash' && s !== 'shelved',
  )

  it('a ~870 px list shows every column on the screens with the 76px actions track', () => {
    for (const screen of ON_76PX_ACTIONS) {
      expect(columnsFor(screen, 870)).toEqual(columnsFor(screen, WIDE))
    }
  })

  it('a ~710 px list hides at most Dung lượng, or Dung lượng + Người sửa with a screen column', () => {
    for (const screen of ON_76PX_ACTIONS) {
      const full = columnsFor(screen, WIDE)
      const hidden = full.filter((c) => !columnsFor(screen, 710).includes(c))
      expect(hidden).toEqual(specialColumn(screen) ? ['editor', 'size'] : ['size'])
    }
  })

  it('on the device list only Dung lượng goes', () => {
    expect(columnsFor('device', 100)).toEqual(['select', 'name', 'updated', 'actions'])
  })

  it('a bad width reads as the full table', () => {
    expect(columnsFor('workspace', Number.NaN)).toContain('size')
  })
})

describe('defaultSort', () => {
  it('is the screen column descending, except trash which runs oldest first (Q2)', () => {
    expect(defaultSort('recent')).toEqual({ column: 'activity', dir: 'desc' })
    expect(defaultSort('starred')).toEqual({ column: 'starred', dir: 'desc' })
    expect(defaultSort('shared')).toEqual({ column: 'shared', dir: 'desc' })
    expect(defaultSort('shared-by-me')).toEqual({ column: 'shared_with', dir: 'desc' })
    expect(defaultSort('shelved')).toEqual({ column: 'shelved', dir: 'desc' })
    expect(defaultSort('trash')).toEqual({ column: 'deleted', dir: 'asc' })
  })

  it('is Cập nhật descending with no screen column', () => {
    expect(defaultSort('workspace')).toEqual({ column: 'updated', dir: 'desc' })
    expect(defaultSort('device')).toEqual({ column: 'updated', dir: 'desc' })
  })
})

describe('isSortable', () => {
  it('Chọn, Truy cập and Thao tác never sort; the others do on their own screen only', () => {
    for (const c of ['select', 'access', 'actions'] as ColumnId[]) {
      expect(isSortable('workspace', c)).toBe(false)
    }
    for (const c of ['name', 'editor', 'updated', 'size'] as ColumnId[]) {
      expect(isSortable('workspace', c)).toBe(true)
    }
    expect(isSortable('recent', 'activity')).toBe(true)
    expect(isSortable('workspace', 'activity')).toBe(false)
    expect(isSortable('trash', 'activity')).toBe(false)
  })

  it('the device list sorts Tên, Cập nhật and Dung lượng', () => {
    expect(isSortable('device', 'editor')).toBe(false)
    expect(isSortable('device', 'size')).toBe(true)
  })
})

describe('nextSort: a new column starts ascending for Tên/Người sửa, descending for the rest', () => {
  it('first click', () => {
    expect(nextSort('workspace', { column: 'updated', dir: 'desc' }, 'name')).toEqual({
      column: 'name',
      dir: 'asc',
    })
    expect(nextSort('workspace', { column: 'updated', dir: 'desc' }, 'editor')).toEqual({
      column: 'editor',
      dir: 'asc',
    })
    expect(nextSort('workspace', { column: 'name', dir: 'asc' }, 'size')).toEqual({
      column: 'size',
      dir: 'desc',
    })
    expect(nextSort('recent', { column: 'updated', dir: 'asc' }, 'activity')).toEqual({
      column: 'activity',
      dir: 'desc',
    })
  })

  it('a second click flips the direction', () => {
    expect(nextSort('workspace', { column: 'name', dir: 'asc' }, 'name')).toEqual({
      column: 'name',
      dir: 'desc',
    })
    expect(nextSort('trash', { column: 'deleted', dir: 'asc' }, 'deleted')).toEqual({
      column: 'deleted',
      dir: 'desc',
    })
  })

  it('a column that cannot sort leaves the sort as it was', () => {
    const cur = { column: 'name', dir: 'asc' } as const
    expect(nextSort('workspace', cur, 'access')).toEqual(cur)
  })
})

describe('sortRows (the order the server will give, until it does)', () => {
  interface Row {
    id: string
    name: string
    editor?: string | null
    size?: number | null
    updated?: string
  }
  const read = (r: Row, c: ColumnId): string | number | null => {
    if (c === 'name') return r.name
    if (c === 'editor') return r.editor ?? null
    if (c === 'size') return r.size ?? 0
    if (c === 'updated') return r.updated ? Date.parse(r.updated) : 0
    return null
  }
  const ids = (rows: Row[]) => rows.map((r) => r.id)

  it('sorts names with the Vietnamese collator: a before ă before â, ties by id', () => {
    const rows: Row[] = [
      { id: '3', name: 'Â' },
      { id: '2', name: 'Ă' },
      { id: '1', name: 'A' },
      { id: '0', name: 'a' },
    ]
    expect(ids(sortRows(rows, { column: 'name', dir: 'asc' }, read))).toEqual(['0', '1', '2', '3'])
    expect(ids(sortRows(rows, { column: 'name', dir: 'desc' }, read))).toEqual(['3', '2', '1', '0'])
  })

  it('a missing editor name sorts last in both directions', () => {
    const rows: Row[] = [
      { id: '1', name: 'x', editor: null },
      { id: '2', name: 'x', editor: 'Bình' },
      { id: '3', name: 'x', editor: 'An' },
    ]
    expect(ids(sortRows(rows, { column: 'editor', dir: 'asc' }, read))).toEqual(['3', '2', '1'])
    expect(ids(sortRows(rows, { column: 'editor', dir: 'desc' }, read))).toEqual(['2', '3', '1'])
  })

  it('sorts numbers and breaks a tie by id in the same direction; no file counts as 0', () => {
    const rows: Row[] = [
      { id: 'b', name: 'x', size: 5 },
      { id: 'a', name: 'x', size: 5 },
      { id: 'c', name: 'x', size: null },
      { id: 'd', name: 'x', size: 9 },
    ]
    expect(ids(sortRows(rows, { column: 'size', dir: 'asc' }, read))).toEqual(['c', 'a', 'b', 'd'])
    expect(ids(sortRows(rows, { column: 'size', dir: 'desc' }, read))).toEqual(['d', 'b', 'a', 'c'])
  })

  it('does not change the list it is given', () => {
    const rows: Row[] = [
      { id: '2', name: 'b' },
      { id: '1', name: 'a' },
    ]
    sortRows(rows, { column: 'name', dir: 'asc' }, read)
    expect(ids(rows)).toEqual(['2', '1'])
  })
})
