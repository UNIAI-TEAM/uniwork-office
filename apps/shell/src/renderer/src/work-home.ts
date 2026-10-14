import { useCallback, useEffect, useState } from 'react'
import type { RecentEntry, UniworkDocSummary } from '../../shared/home-api'
import type {
  UniworkWorkError,
  WorkHomeSummary,
  WorkRecentDocument,
  WorkTask,
} from '../../shared/uniwork-work-api'
import { workbenchStrings } from './i18n/strings-workbench'
import type { StringKey } from './locale'
import { isOpenable } from './uniwork-docs-model'

// window.uniworkWork is declared once, in Home.tsx (Task 8)

// ── Pure helpers (ported from uniwork:packages/core/home/brief.ts and views/home) ──

const DAY_MS = 86_400_000

function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS
}

/** whole days a due date lies before `today` (both YYYY-MM-DD); 0 when not overdue */
export function overdueDays(today: string, due: string | undefined): number {
  if (!due) return 0
  const t = dayNumber(today)
  const d = dayNumber(due)
  if (t === null || d === null) return 0
  return Math.max(0, t - d)
}

/** calendar day of an instant in the person's zone, as YYYY-MM-DD */
export function localDay(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return iso.slice(0, 10)
  }
}

/** wall-clock HH:mm of an instant, in the summary's zone when it names one */
export function clock(iso: string, locale: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: timeZone || undefined }).format(d)
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(d)
  }
}

/** a YYYY-MM-DD day as written (no zone shift): long = weekday, day and month */
export function formatDay(day: string, locale: string, long: boolean): string {
  const date = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  const text = new Intl.DateTimeFormat(
    locale,
    long
      ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', timeZone: 'UTC' },
  ).format(date)
  // the long form opens a heading: sentence case ("mercredi 14 octobre" -> "Mercredi 14 octobre")
  return long ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text
}

/**
 * Common Vietnamese family names without diacritics (port of uniwork
 * packages/core/home/greeting.ts). A name that starts with one is written family-first, so a
 * person is called by the last word ("Phan Đức Quang" -> "Quang"); any other name is
 * given-first ("Ada Lovelace" -> "Ada").
 */
const VI_FAMILY_NAMES = new Set(
  (
    'nguyen tran le pham hoang huynh phan vu vo dang bui do ho ngo duong ly dinh doan trinh ' +
    'truong lam mai cao ta ha luu luong to chau quach tong thai kieu trieu khuc la van vuong ' +
    'lai ton tang'
  ).split(' '),
)

const plainWord = (word: string) =>
  word.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

/** The name the greeting calls a person by; the whole (trimmed) name when it is one word. */
export function greetingName(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return displayName.trim()
  return VI_FAMILY_NAMES.has(plainWord(words[0]!)) ? words[words.length - 1]! : words[0]!
}

export type DueState = 'overdue' | 'today' | 'later' | 'none'

export function dueState(task: WorkTask, today: string): DueState {
  if (task.status === 'done' || !task.due_date) return 'none'
  if (overdueDays(today, task.due_date) > 0) return 'overdue'
  return task.due_date === today ? 'today' : 'later'
}

export type MyWorkGroup = 'overdue' | 'today' | 'upcoming'

/** Overview "My work" groups in display order; a ticked task keeps its due group (not 'none'). */
export function myWorkGroups(
  tasks: readonly WorkTask[],
  today: string,
): { key: MyWorkGroup; tasks: WorkTask[] }[] {
  const groups: Record<MyWorkGroup, WorkTask[]> = { overdue: [], today: [], upcoming: [] }
  for (const task of tasks) {
    const due = dueState({ ...task, status: 'todo' }, today)
    groups[due === 'overdue' || due === 'today' ? due : 'upcoming'].push(task)
  }
  return (['overdue', 'today', 'upcoming'] as const)
    .filter((key) => groups[key].length > 0)
    .map((key) => ({ key, tasks: groups[key] }))
}

export type TabCount = { n: number; key: StringKey; tone: 'danger' | 'muted' }

/**
 * The Tasks and Calendar tab counts from the Overview summary. A failed source
 * or a malformed (null) count shows nothing: its zeros are not true.
 */
export function tabCounts(
  s: WorkHomeSummary | null,
): Partial<Record<'tasks' | 'calendar', TabCount>> {
  const out: Partial<Record<'tasks' | 'calendar', TabCount>> = {}
  if (!s) return out
  const { overdue, due_today, meetings_today } = s.counts
  if (!s.partial.includes('tasks') && overdue !== null) {
    if (overdue > 0) out.tasks = { n: overdue, key: 'wbTabCountOverdue', tone: 'danger' }
    else if ((due_today ?? 0) > 0)
      out.tasks = { n: due_today!, key: 'wbTabCountDueToday', tone: 'muted' }
  }
  if (!s.partial.includes('meetings') && (meetings_today ?? 0) > 0)
    out.calendar = { n: meetings_today!, key: 'wbTabCountMeetings', tone: 'muted' }
  return out
}

export function withTaskStatus(
  summary: WorkHomeSummary,
  taskId: string,
  status: string,
): WorkHomeSummary {
  return {
    ...summary,
    my_work: summary.my_work.map((t) => (t.id === taskId ? { ...t, status } : t)),
  }
}

/**
 * Cloud documents that open in the editor plus local recents, newest first.
 * A local working copy of a UniWork document is left out: the cloud row opens it.
 */
export function mergeRecentDocuments(
  cloud: readonly UniworkDocSummary[],
  local: readonly RecentEntry[],
  limit = 6,
): WorkRecentDocument[] {
  const rows: { at: number; row: WorkRecentDocument }[] = [
    ...cloud.filter(isOpenable).map((doc) => ({
      at: Date.parse(doc.updatedAt) || 0,
      row: { source: 'uniwork' as const, doc },
    })),
    ...local
      .filter((entry) => !entry.missing && !entry.uniwork)
      .map((entry) => ({ at: entry.mtimeMs, row: { source: 'local' as const, entry } })),
  ]
  return rows
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((r) => r.row)
}

/** the server sends title_key + params; the desktop keeps one sentence per kind (C10) */
export function notificationKey(kind: string): StringKey {
  const key = `wbNotif_${kind}`
  return Object.hasOwn(workbenchStrings.zh, key) ? (key as StringKey) : 'wbNotifFallback'
}

export type OverviewView =
  'loading' | 'ready' | 'stale' | 'no-workspace' | 'signed-out' | 'forbidden' | 'unreachable'

/** which of the spec §7 states the Overview shows */
export function overviewView(i: {
  workspaces: readonly unknown[] | null
  workspaceError: UniworkWorkError | null
  summary: WorkHomeSummary | null
  error: UniworkWorkError | null
}): OverviewView {
  const error = i.workspaceError ?? i.error
  if (error === 'signed-out' || error === 'forbidden') return error
  // a summary on screen stays through an offline/server failure of the list or the summary
  if (i.summary) return error ? 'stale' : 'ready'
  if (i.workspaceError) return 'unreachable'
  if (i.workspaces === null) return 'loading'
  if (i.workspaces.length === 0) return 'no-workspace'
  return i.error ? 'unreachable' : 'loading'
}

// ── Hooks ──

export const HOME_REFRESH_MS = 60_000

/**
 * "Tài liệu gần đây": the workspace's cloud recents (signed in) plus this device's
 * recents, reloaded like the summary (Refresh, window focus, every HOME_REFRESH_MS
 * while visible). `cloudFailed`: the cloud list did not load, so only local files show.
 */
export function useRecentDocuments(
  workspaceId: string | null,
  refreshTick: number,
  limit = 6,
): {
  docs: WorkRecentDocument[]
  /** this device's recents as listed (working copies included), for the Desk's tray */
  local: RecentEntry[]
  cloudFailed: boolean
  /** false until the first answer: an empty list before it is not "nothing recent" */
  loaded: boolean
  reload: () => void
} {
  const [state, setState] = useState({
    docs: [] as WorkRecentDocument[],
    local: [] as RecentEntry[],
    cloudFailed: false,
    loaded: false,
  })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, HOME_REFRESH_MS)
    window.addEventListener('focus', reload)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', reload)
    }
  }, [reload])
  useEffect(() => {
    let live = true
    const local = window.aiOffice.recents({ limit: 20 }).then(
      (page) => page.entries,
      () => [] as RecentEntry[],
    )
    const cloud: Promise<UniworkDocSummary[] | null> = workspaceId
      ? window.aiOffice.uniworkListDocuments({ workspaceId, limit: 20 }).then(
          (r) => (r.ok ? r.value.documents : null),
          () => null,
        )
      : Promise.resolve([])
    void Promise.all([cloud, local]).then(([c, l]) => {
      if (live) {
        setState({
          docs: mergeRecentDocuments(c ?? [], l, limit),
          local: l,
          cloudFailed: c === null,
          loaded: true,
        })
      }
    })
    return () => {
      live = false
    }
  }, [workspaceId, refreshTick, tick, limit])
  return { ...state, reload }
}
