// What a list remembers per account and screen: its sort, its collapsed
// groups and the Recent segment. All live in the Workbench store, which is
// already one bucket per UniWork account, under the allowed `uniwork.wb.`
// prefix. Values the code does not know are dropped; a store that cannot be
// read or written leaves the defaults, so a list always renders.
import { wbStoreRead, wbStoreWrite } from '../workbench-store-client'
import { DOC_LIST_SCREENS, isSortable, type DocListScreen, type SortSpec } from './columns'
import { groupIdsFor, type GroupId } from './groups'

export const DOCLIST_SORT_KEY = 'uniwork.wb.doclist.sort'
export const DOCLIST_GROUPS_KEY = 'uniwork.wb.doclist.groups'
export const DOCLIST_SEGMENT_KEY = 'uniwork.wb.doclist.segment'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function readMap(key: string): Record<string, unknown> {
  try {
    const value = wbStoreRead<unknown>(key, null)
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function writeMap(key: string, value: Record<string, unknown>): void {
  try {
    wbStoreWrite(key, value)
  } catch {
    /* an unwritable store keeps nothing; the list still works */
  }
}

const screenOf = (name: string): DocListScreen | null =>
  (DOC_LIST_SCREENS as readonly string[]).includes(name) ? (name as DocListScreen) : null

function cleanSort(screen: DocListScreen, value: unknown): SortSpec | null {
  if (!isRecord(value)) return null
  const { column, dir } = value
  if (dir !== 'asc' && dir !== 'desc') return null
  if (typeof column !== 'string') return null
  const spec = { column, dir } as SortSpec
  return isSortable(screen, spec.column) ? spec : null
}

function cleanSorts(): Partial<Record<DocListScreen, SortSpec>> {
  const out: Partial<Record<DocListScreen, SortSpec>> = {}
  for (const [name, value] of Object.entries(readMap(DOCLIST_SORT_KEY))) {
    const screen = screenOf(name)
    const sort = screen ? cleanSort(screen, value) : null
    if (screen && sort) out[screen] = sort
  }
  return out
}

/** the stored sort of a screen, or null (use `defaultSort`) */
export function readSort(screen: DocListScreen): SortSpec | null {
  return cleanSorts()[screen] ?? null
}

export function writeSort(screen: DocListScreen, sort: SortSpec): void {
  writeMap(DOCLIST_SORT_KEY, { ...cleanSorts(), [screen]: sort })
}

function cleanGroups(): Partial<Record<DocListScreen, GroupId[]>> {
  const out: Partial<Record<DocListScreen, GroupId[]>> = {}
  for (const [name, value] of Object.entries(readMap(DOCLIST_GROUPS_KEY))) {
    const screen = screenOf(name)
    if (!screen || !Array.isArray(value)) continue
    const valid = groupIdsFor(screen)
    const ids = [...new Set(value)].filter((id): id is GroupId => valid.includes(id as GroupId))
    if (ids.length) out[screen] = ids
  }
  return out
}

/** the collapsed group ids of a screen (the web shape `{"<screen>":["<groupId>"]}`) */
export function readCollapsedGroups(screen: DocListScreen): GroupId[] {
  return cleanGroups()[screen] ?? []
}

export function writeCollapsedGroups(screen: DocListScreen, ids: readonly GroupId[]): void {
  const next = { ...cleanGroups() }
  const valid = groupIdsFor(screen)
  const kept = [...new Set(ids)].filter((id) => valid.includes(id))
  if (kept.length) next[screen] = kept
  else delete next[screen]
  writeMap(DOCLIST_GROUPS_KEY, next)
}

/** collapses or expands one group and returns the collapsed ids after the change */
export function toggleGroup(screen: DocListScreen, id: GroupId): GroupId[] {
  const current = readCollapsedGroups(screen)
  const next = current.includes(id) ? current.filter((g) => g !== id) : [...current, id]
  writeCollapsedGroups(screen, next)
  return next.filter((g) => groupIdsFor(screen).includes(g))
}

/** the Recent screen's segment: Tất cả, Đã mở (last touch = opened) or Đã sửa (edited) */
export type RecentSegment = 'all' | 'opened' | 'edited'

/** the stored Recent segment (`{"recent":"opened"}`); anything else reads as Tất cả */
export function readRecentSegment(): RecentSegment {
  const value = readMap(DOCLIST_SEGMENT_KEY).recent
  return value === 'opened' || value === 'edited' ? value : 'all'
}

export function writeRecentSegment(segment: RecentSegment): void {
  writeMap(DOCLIST_SEGMENT_KEY, segment === 'all' ? {} : { recent: segment })
}
