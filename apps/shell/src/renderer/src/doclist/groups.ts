// The time groups of the screens that group (recent, shared, trash) and the
// "N days left" count of the trash. Pure functions of `now`, so the
// boundaries (Monday 00:00, yesterday on a Monday, 7 and 8 days) are testable;
// doclist-vectors.json holds them for the web and the app alike.
import type { DocListKey } from './text'
import type { ColumnId, DocListScreen, SortSpec } from './columns'

export type GroupId =
  'today' | 'yesterday' | 'this_week' | 'earlier' | 'deleting_soon' | 'more_than_7_days'

const DAY_MS = 24 * 60 * 60 * 1000
/** a trashed item at or under this many days left is "Sắp xóa vĩnh viễn" (and its days-left text is destructive-coloured) */
export const DELETING_SOON_DAYS = 7

const GROUPS: Partial<Record<DocListScreen, readonly GroupId[]>> = {
  recent: ['today', 'yesterday', 'this_week', 'earlier'],
  shared: ['this_week', 'earlier'],
  trash: ['deleting_soon', 'more_than_7_days'],
}

/** the screen's groups in display order; none for a screen that does not group */
export function groupIdsFor(screen: DocListScreen): readonly GroupId[] {
  return GROUPS[screen] ?? []
}

/** the column each grouping screen's groups follow */
const GROUP_COLUMN: Partial<Record<DocListScreen, ColumnId>> = {
  recent: 'activity',
  shared: 'shared',
  trash: 'deleted',
}

export const GROUP_LABEL_KEY: Record<GroupId, DocListKey> = {
  today: 'dlGroupToday',
  yesterday: 'dlGroupYesterday',
  this_week: 'dlGroupThisWeek',
  earlier: 'dlGroupEarlier',
  deleting_soon: 'dlGroupDeletingSoon',
  more_than_7_days: 'dlGroupMoreThan7Days',
}

function parse(at: string | null | undefined): Date | null {
  if (!at) return null
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfDay(date: Date, offsetDays = 0): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays).getTime()
}

/** Monday 00:00 of the week `now` falls in (local time) */
function startOfWeek(now: Date): number {
  return startOfDay(now, -((now.getDay() + 6) % 7))
}

/**
 * Whole days a trashed item has left: max(1, ceil((purge_after - now) / 24h)),
 * so the last day still reads "1 day". Null when there is no usable date.
 */
export function daysLeft(purgeAfter: string | null | undefined, now: Date): number | null {
  const purge = parse(purgeAfter)
  if (!purge) return null
  return Math.max(1, Math.ceil((purge.getTime() - now.getTime()) / DAY_MS))
}

export interface GroupInput {
  /** the date the screen groups by: `last_activity.at` (recent), `shared.at` (shared) */
  at?: string | null
  purgeAfter?: string | null
}

/**
 * The group a row sits in. Recent: Hôm nay / Hôm qua / Tuần này (from Monday
 * 00:00, minus today and yesterday) / Trước đó. Shared: Tuần này / Trước đó, so
 * yesterday on a Monday is the week before. Trash: Sắp xóa vĩnh viễn at 7 days
 * left or fewer, else Còn trên 7 ngày. A missing or invalid date is the last
 * group; a date after `now` (clock drift) counts as now. Null on a screen that
 * does not group.
 */
export function groupOf(screen: DocListScreen, input: GroupInput, now: Date): GroupId | null {
  if (screen === 'trash') {
    const left = daysLeft(input.purgeAfter, now)
    return left !== null && left <= DELETING_SOON_DAYS ? 'deleting_soon' : 'more_than_7_days'
  }
  if (screen !== 'recent' && screen !== 'shared') return null
  const at = parse(input.at)
  if (!at) return 'earlier'
  const time = at.getTime()
  if (screen === 'recent') {
    if (time >= startOfDay(now)) return 'today'
    if (time >= startOfDay(now, -1)) return 'yesterday'
  }
  return time >= startOfWeek(now) ? 'this_week' : 'earlier'
}

/**
 * Groups show only while the list is sorted by the screen's own column (its
 * groups are then consecutive runs, in either direction); sorted by anything
 * else the list is flat.
 */
export function groupsActive(screen: DocListScreen, sort: SortSpec): boolean {
  return sort.column === GROUP_COLUMN[screen]
}

export interface RowGroup<T> {
  /** null: one flat run on a screen that does not group */
  id: GroupId | null
  rows: T[]
}

/**
 * Splits an ordered list into consecutive runs of one group. A later page
 * that continues the last group joins its run; a screen that does not group
 * gives one flat run.
 */
export function groupRows<T>(
  screen: DocListScreen,
  rows: readonly T[],
  now: Date,
  input: (row: T) => GroupInput,
): RowGroup<T>[] {
  if (rows.length === 0) return []
  if (groupIdsFor(screen).length === 0) return [{ id: null, rows: [...rows] }]
  const out: RowGroup<T>[] = []
  for (const row of rows) {
    const id = groupOf(screen, input(row), now)
    const last = out.at(-1)
    if (last && last.id === id) last.rows.push(row)
    else out.push({ id, rows: [row] })
  }
  return out
}
