// Which columns a Documents list has, in which order, how they hide as the
// table narrows, and how they sort. The screen ids are the shared rules' ids
// plus `device` (the local files list of Home).
import type { DocListKey } from './text'

export const DOC_LIST_SCREENS = [
  'workspace',
  'recent',
  'starred',
  'shared',
  'shared-by-me',
  'shelved',
  'trash',
  'device',
] as const
export type DocListScreen = (typeof DOC_LIST_SCREENS)[number]

export type SpecialColumnId =
  'activity' | 'starred' | 'shared' | 'shared_with' | 'shelved' | 'deleted'
export type ColumnId =
  'select' | 'name' | SpecialColumnId | 'access' | 'editor' | 'updated' | 'size' | 'actions'

export interface SortSpec {
  column: ColumnId
  dir: 'asc' | 'desc'
}

const SPECIAL: Record<DocListScreen, SpecialColumnId | null> = {
  workspace: null,
  recent: 'activity',
  starred: 'starred',
  shared: 'shared',
  'shared-by-me': 'shared_with',
  shelved: 'shelved',
  trash: 'deleted',
  device: null,
}

/** the screen's own column (after Tên), or null */
export function specialColumn(screen: DocListScreen): SpecialColumnId | null {
  return SPECIAL[screen]
}

export const COLUMN_LABEL_KEY: Record<ColumnId, DocListKey> = {
  select: 'dlColSelect',
  name: 'dlColName',
  activity: 'dlColActivity',
  starred: 'dlColStarred',
  shared: 'dlColShared',
  shared_with: 'dlColSharedWith',
  shelved: 'dlColShelved',
  deleted: 'dlColDeleted',
  access: 'dlColAccess',
  editor: 'dlColEditor',
  updated: 'dlColUpdated',
  size: 'dlColSize',
  actions: 'dlColActions',
}

/** the order columns hide in as the table narrows: Dung lượng, then Người sửa gần nhất, then Truy cập */
export const NARROW_HIDING_ORDER = ['size', 'editor', 'access'] as const

const REM = 16
/**
 * Fixed cell widths in px (cell padding included), the same numbers as the
 * web's `docListSpec` (doclist/columns.ts): the table is fixed-layout and Name
 * takes what is left, never less than NAME_FLOOR.
 */
const WIDTH = {
  select: 32,
  updated: 118,
  actions: 76,
  special: 118,
  access: 120,
  editor: 130,
  size: 84,
}
/** the shelf's row carries a Bỏ lưu trữ button and the trash row a Khôi phục button before its "…": their actions track is wider */
export const BUTTON_ACTIONS_WIDTH = 176
export const hasButtonActions = (screen: DocListScreen): boolean =>
  screen === 'shelved' || screen === 'trash'
/** the table's 1px borders, both sides */
const BORDER = 2
/** the room Tên keeps before a column joins */
const NAME_FLOOR = 184

/**
 * Table width (px) a hideable column needs to show, derived the way the web's
 * `docListRungs` does: every column on screen up to and including it + the
 * border + the Name floor, rounded up to the next rem. That is 34 / 42 / 47 rem
 * for Truy cập / Người sửa / Dung lượng, and 41 / 49 / 54 rem with a screen
 * column, so a ~870 px list shows everything and ~710 px hides at most Dung
 * lượng (plus Người sửa with a screen column). Tên, Chọn, Cập nhật, Thao tác
 * and the screen column never hide.
 */
function rungsOf(
  special: boolean,
  actions: number,
): Record<(typeof NARROW_HIDING_ORDER)[number], number> {
  const rem = (px: number): number => Math.ceil(px / REM) * REM
  const base =
    WIDTH.select + WIDTH.updated + actions + (special ? WIDTH.special : 0) + BORDER + NAME_FLOOR
  const access = base + WIDTH.access
  const editor = access + WIDTH.editor
  return { access: rem(access), editor: rem(editor), size: rem(editor + WIDTH.size) }
}
const RUNGS = {
  plain: rungsOf(false, WIDTH.actions),
  special: rungsOf(true, WIDTH.actions),
  /** Trash and Lưu trữ: always a screen column, and the wide actions track */
  buttons: rungsOf(true, BUTTON_ACTIONS_WIDTH),
}
/** the device list has only Dung lượng to hide */
const DEVICE_SIZE_RUNG = 40 * REM

/**
 * The columns of a screen at a table width in px, in the fixed order
 * Chọn · Tên · [đặc trưng] · Truy cập · Người sửa gần nhất · Cập nhật ·
 * Dung lượng · Thao tác. No (or an unusable) width means the full table.
 */
export function columnsFor(screen: DocListScreen, width?: number): ColumnId[] {
  const w = typeof width === 'number' && Number.isFinite(width) ? width : Number.POSITIVE_INFINITY
  if (screen === 'device') {
    return [
      'select',
      'name',
      'updated',
      ...(w >= DEVICE_SIZE_RUNG ? (['size'] as const) : []),
      'actions',
    ]
  }
  const special = SPECIAL[screen]
  const rungs = RUNGS[hasButtonActions(screen) ? 'buttons' : special ? 'special' : 'plain']
  return [
    'select',
    'name',
    ...(special ? [special] : []),
    ...(w >= rungs.access ? (['access'] as const) : []),
    ...(w >= rungs.editor ? (['editor'] as const) : []),
    'updated',
    ...(w >= rungs.size ? (['size'] as const) : []),
    'actions',
  ]
}

/** the screen column newest-first, except trash which runs oldest-deletion first (Q2); Cập nhật newest-first without one */
export function defaultSort(screen: DocListScreen): SortSpec {
  const special = SPECIAL[screen]
  if (!special) return { column: 'updated', dir: 'desc' }
  return { column: special, dir: screen === 'trash' ? 'asc' : 'desc' }
}

/** Chọn, Truy cập and Thao tác never sort; the screen column sorts on its own screen only; the device list has no Người sửa */
export function isSortable(screen: DocListScreen, column: ColumnId): boolean {
  switch (column) {
    case 'name':
    case 'updated':
    case 'size':
      return true
    case 'editor':
      return screen !== 'device'
    case 'select':
    case 'access':
    case 'actions':
      return false
    default:
      return SPECIAL[screen] === column
  }
}

/**
 * The sort after clicking a header. A new column starts ascending for Tên and
 * Người sửa gần nhất, descending for the rest; the same column flips. A column
 * that cannot sort leaves the sort as it was.
 */
export function nextSort(screen: DocListScreen, current: SortSpec, column: ColumnId): SortSpec {
  if (!isSortable(screen, column)) return current
  if (current.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { column, dir: column === 'name' || column === 'editor' ? 'asc' : 'desc' }
}

const collator = new Intl.Collator('vi', { sensitivity: 'variant' })
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * A sorted copy of loaded rows, in the order the server will give (until
 * it does): names with the Vietnamese collator at tertiary strength, numbers
 * (dates as epoch, no file as 0) numerically, a tie broken by id by code
 * point in the same direction, a missing name (`null`) last in both
 * directions. `read` returns the value of a column for a row.
 */
export function sortRows<T extends { id: string }>(
  rows: readonly T[],
  sort: SortSpec,
  read: (row: T, column: ColumnId) => string | number | null,
): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = read(a, sort.column)
    const y = read(b, sort.column)
    if (x === null || y === null) {
      if (x === y) return sign * byCodePoint(a.id, b.id)
      return x === null ? 1 : -1
    }
    const diff =
      typeof x === 'string' && typeof y === 'string'
        ? collator.compare(x, y)
        : (x as number) - (y as number)
    return diff !== 0 ? sign * diff : sign * byCodePoint(a.id, b.id)
  })
}
