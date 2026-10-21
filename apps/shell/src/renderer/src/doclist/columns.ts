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
  'elsewhere',
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
  elsewhere: null,
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
/** V-LAYOUT F-05: the Trash cell holds a name over "20 thg 10 · Còn 13 ngày", the countdown never cut */
const DELETED_WIDTH = 160
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
const rem = (px: number): number => Math.ceil(px / REM) * REM
function rungsOf(
  special: number,
  actions: number,
): Record<(typeof NARROW_HIDING_ORDER)[number], number> {
  const base = WIDTH.select + WIDTH.updated + actions + special + BORDER + NAME_FLOOR
  const access = base + WIDTH.access
  const editor = access + WIDTH.editor
  return { access: rem(access), editor: rem(editor), size: rem(editor + WIDTH.size) }
}
/**
 * RV7-9: the px a coarse pointer adds to the Starred actions track while its rows draw the Sao button
 * (two 44px buttons: 108px against the ladder's 76px; documents-home.css `--dh-star-actions-track`).
 * DocList feeds it to the ladder, so the ⋯ is never clipped just above a rung.
 */
export const COARSE_STAR_ACTIONS_EXTRA = 32

function rungsFor(
  screen: DocListScreen,
  actionsExtra: number,
): Record<(typeof NARROW_HIDING_ORDER)[number], number> {
  if (screen === 'trash') return rungsOf(DELETED_WIDTH, BUTTON_ACTIONS_WIDTH)
  if (screen === 'shelved') return rungsOf(WIDTH.special, BUTTON_ACTIONS_WIDTH)
  return rungsOf(SPECIAL[screen] ? WIDTH.special : 0, WIDTH.actions + actionsExtra)
}
/** the device list has only Dung lượng to hide */
const DEVICE_SIZE_RUNG = 40 * REM

/**
 * The columns of a screen at a table width in px, in the fixed order
 * Chọn · Tên · [đặc trưng] · Truy cập · Người sửa gần nhất · Cập nhật ·
 * Dung lượng · Thao tác. No (or an unusable) width means the full table.
 */
export function columnsFor(screen: DocListScreen, width?: number, actionsExtra = 0): ColumnId[] {
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
  const rungs = rungsFor(screen, actionsExtra)
  return [
    // a source file of another module cannot be selected: its page has no Chọn column
    ...(screen === 'elsewhere' ? [] : (['select'] as const)),
    'name',
    ...(special ? [special] : []),
    ...(w >= rungs.access ? (['access'] as const) : []),
    ...(w >= rungs.editor ? (['editor'] as const) : []),
    'updated',
    ...(w >= rungs.size ? (['size'] as const) : []),
    'actions',
  ]
}

/**
 * Below the ladder (V-LAYOUT F-01). The web ladder stops once Truy cập, Người sửa and Dung lượng are
 * gone, but a 374px list (a 768 window) still needs 404-522px before Tên has its floor. Two more
 * steps keep the row inside its box, narrowest last:
 *  1. the screen column goes when the table cannot hold it next to Tên's floor (the Trash and Lưu trữ
 *     rows keep their Khôi phục / Bỏ lưu trữ button: it is an action, not data);
 *  2. the table is `compact`: Cập nhật is an 84px track whose date wraps onto two lines, Tên a flexible
 *     one (floor 110px), the button screens' actions track 140px, and their Chọn column is dropped.
 * Tên keeps >= 180px in a 374px box and >= 110px in a 326px one (a 720 window, the shell's minimum;
 * the button screens' 389 / 341px boxes leave it 163 / 115px).
 * Tables the ladder fits, and an unmeasured one, are left as they are.
 */
export const COMPACT_WIDTH = { updated: 84, name: 110, buttonActions: 140 }

const usable = (width?: number): width is number =>
  typeof width === 'number' && Number.isFinite(width) && width > 0

/** the width under which a table cannot hold the full Tên floor next to Chọn, Cập nhật and Thao tác */
export function isCompact(screen: DocListScreen, width?: number, actionsExtra = 0): boolean {
  if (!usable(width)) return false
  const actions = hasButtonActions(screen) ? BUTTON_ACTIONS_WIDTH : WIDTH.actions + actionsExtra
  return width < rem(WIDTH.select + NAME_FLOOR + WIDTH.updated + actions + BORDER)
}

/** the columns of `columnsFor`, less what the table's own width cannot hold below the ladder */
export function fitColumns(
  screen: DocListScreen,
  columns: readonly ColumnId[],
  width?: number,
  actionsExtra = 0,
): ColumnId[] {
  if (!usable(width)) return [...columns]
  const special = SPECIAL[screen]
  const specialWidth = screen === 'trash' ? DELETED_WIDTH : WIDTH.special
  const actions = hasButtonActions(screen) ? BUTTON_ACTIONS_WIDTH : WIDTH.actions + actionsExtra
  const specialRung = rem(
    WIDTH.select + NAME_FLOOR + WIDTH.updated + actions + specialWidth + BORDER,
  )
  const compact = isCompact(screen, width, actionsExtra)
  return columns.filter(
    (column) =>
      !(special !== null && column === special && width < specialRung) &&
      !(compact && hasButtonActions(screen) && column === 'select'),
  )
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
