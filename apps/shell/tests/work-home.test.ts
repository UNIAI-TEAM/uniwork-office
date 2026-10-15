import { describe, expect, it } from 'vitest'
import type { RecentEntry, UniworkDocSummary } from '../src/shared/home-api'
import type { WorkHomeSummary, WorkTask } from '../src/shared/uniwork-work-api'
import {
  dueState,
  formatDay,
  greetingName,
  localDay,
  mergeRecentDocuments,
  myWorkGroups,
  notificationKey,
  overdueDays,
  overviewView,
  tabCounts,
  withTaskStatus,
} from '../src/renderer/src/work-home'

const TODAY = '2026-10-13'

function task(over: Partial<WorkTask> = {}): WorkTask {
  return {
    id: 't1',
    workspace_id: 'w',
    identifier: 'OPS-7',
    title: 'Send the contract',
    status: 'todo',
    priority: 'high',
    due_date: '2026-10-10',
    updated_at: '2026-10-10T08:00:00Z',
    ...over,
  }
}

const ZERO = { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 }

function summary(over: Partial<WorkHomeSummary> = {}): WorkHomeSummary {
  return {
    today: TODAY,
    timezone: 'Asia/Ho_Chi_Minh',
    counts: ZERO,
    my_work: [],
    upcoming_meetings: [],
    inbox: [],
    partial: [],
    generated_at: '2026-10-13T03:00:00Z',
    ...over,
  }
}

describe('greetingName', () => {
  it.each([
    ['Phan Đức Quang', 'Quang'],
    ['Nguyễn Văn An', 'An'],
    ['Nguyen Van An', 'An'],
    ['  Trần   Thị Bích  ', 'Bích'],
    ['Đỗ Minh', 'Minh'],
    ['Ada Lovelace', 'Ada'],
    ['Lan Nguyen', 'Lan'],
    ['Linh', 'Linh'],
    ['  Linh ', 'Linh'],
    ['', ''],
  ])('splits Vietnamese and Western names correctly: %j -> %j', (full, short) => {
    expect(greetingName(full)).toBe(short)
  })
})

describe('overdueDays and dueState', () => {
  it('counts whole days late; 0 when on time or undated', () => {
    expect(overdueDays(TODAY, '2026-10-10')).toBe(3)
    expect(overdueDays(TODAY, TODAY)).toBe(0)
    expect(overdueDays(TODAY, undefined)).toBe(0)
  })
  it('labels a row overdue, today, later or none (done or undated)', () => {
    expect(dueState(task(), TODAY)).toBe('overdue')
    expect(dueState(task({ due_date: TODAY }), TODAY)).toBe('today')
    expect(dueState(task({ due_date: '2026-10-20' }), TODAY)).toBe('later')
    expect(dueState(task({ due_date: undefined }), TODAY)).toBe('none')
    expect(dueState(task({ status: 'done' }), TODAY)).toBe('none')
  })
})

describe('withTaskStatus', () => {
  it('changes the status of one task only', () => {
    const s = summary({ my_work: [task(), task({ id: 't2' })] })
    expect(withTaskStatus(s, 't2', 'done').my_work.map((t) => t.status)).toEqual(['todo', 'done'])
    expect(s.my_work[1]!.status).toBe('todo')
  })
})

describe('mergeRecentDocuments', () => {
  const doc = (id: string, title: string, format: UniworkDocSummary['format'], updatedAt: string) =>
    ({ id, workspaceId: 'w', title, format, updatedAt }) as UniworkDocSummary
  const entry = (path: string, iso: string, over: Partial<RecentEntry> = {}) =>
    ({
      path,
      name: path.slice(1),
      ext: 'docx',
      mtimeMs: Date.parse(iso),
      sizeBytes: 1,
      starred: false,
      ...over,
    }) as RecentEntry

  it('drops files that cannot open, missing files and working copies, newest first', () => {
    const rows = mergeRecentDocuments(
      [
        doc('d1', 'Plan.docx', 'docx', '2026-10-12T09:00:00Z'),
        doc('d2', 'Photo.png', null, '2026-10-13T09:00:00Z'),
      ],
      [
        entry('/a.docx', '2026-10-11T09:00:00Z'),
        entry('/gone.docx', '2026-10-14T09:00:00Z', { missing: true }),
        entry('/copy.docx', '2026-10-14T09:00:00Z', {
          uniwork: { documentId: 'd1', workspaceId: 'w', title: 'Plan', access: 'edit' },
        }),
      ],
    )
    expect(rows.map((r) => (r.source === 'uniwork' ? r.doc.id : r.entry.path))).toEqual([
      'd1',
      '/a.docx',
    ])
  })
  it('shows at most six', () => {
    const local = Array.from({ length: 9 }, (_, i) =>
      entry(`/f${i}.docx`, `2026-10-0${i + 1}T09:00:00Z`),
    )
    expect(mergeRecentDocuments([], local)).toHaveLength(6)
  })
})

describe('notificationKey', () => {
  it('uses the desktop sentence of a known kind, else the fallback', () => {
    expect(notificationKey('task_assigned')).toBe('wbNotif_task_assigned')
    expect(notificationKey('something_new')).toBe('wbNotifFallback')
    expect(notificationKey('constructor')).toBe('wbNotifFallback')
  })
})

describe('overviewView', () => {
  const ws = [{}]
  const s = summary()
  const v = (
    workspaces: readonly unknown[] | null,
    workspaceError: Parameters<typeof overviewView>[0]['workspaceError'],
    sum: WorkHomeSummary | null,
    error: Parameters<typeof overviewView>[0]['error'],
  ) => overviewView({ workspaces, workspaceError, summary: sum, error })

  it('maps list and summary state to one view (spec §7)', () => {
    expect(v([], 'signed-out', null, null)).toBe('signed-out')
    expect(v([], 'offline', null, null)).toBe('unreachable')
    expect(v(null, null, null, null)).toBe('loading')
    expect(v([], null, null, null)).toBe('no-workspace')
    expect(v(ws, null, null, null)).toBe('loading')
    expect(v(ws, null, s, null)).toBe('ready')
    expect(v(ws, null, s, 'offline')).toBe('stale')
    expect(v(ws, null, s, 'server')).toBe('stale')
    expect(v(ws, null, s, 'forbidden')).toBe('forbidden')
    expect(v(ws, null, null, 'signed-out')).toBe('signed-out')
    expect(v(ws, null, null, 'offline')).toBe('unreachable')
    // an offline Refresh keeps the workspace and its cached summary (Task 12)
    expect(v(ws, 'offline', s, null)).toBe('stale')
    expect(v(ws, 'offline', s, 'offline')).toBe('stale')
    expect(v(ws, 'server', s, null)).toBe('stale')
    expect(v(ws, 'offline', null, null)).toBe('unreachable')
  })
})

describe('localDay', () => {
  it('reads the day in the summary zone, not the device zone, near midnight', () => {
    // 11:30 UTC on the 13th is 00:30 on the 14th in Auckland (UTC+13), but still the 13th
    // on any device clock from UTC−11 to UTC+12 (Ho Chi Minh City included)
    expect(localDay('2026-10-13T11:30:00Z', 'Pacific/Auckland')).toBe('2026-10-14')
  })
})
describe('tabCounts (Tasks and Calendar tab counts from the cached summary)', () => {
  it('shows nothing without a summary or when every count is zero', () => {
    expect(tabCounts(null)).toEqual({})
    expect(tabCounts(summary())).toEqual({})
  })

  it('Tasks shows overdue in danger first, else what is due today, muted', () => {
    expect(tabCounts(summary({ counts: { ...ZERO, overdue: 2, due_today: 5 } })).tasks).toEqual({
      n: 2,
      key: 'wbTabCountOverdue',
      tone: 'danger',
    })
    expect(tabCounts(summary({ counts: { ...ZERO, due_today: 5 } })).tasks).toEqual({
      n: 5,
      key: 'wbTabCountDueToday',
      tone: 'muted',
    })
  })

  it('Calendar shows the meetings today', () => {
    expect(tabCounts(summary({ counts: { ...ZERO, meetings_today: 1 } }))).toEqual({
      calendar: { n: 1, key: 'wbTabCountMeetings', tone: 'muted' },
    })
  })

  it('a failed source or a malformed count shows no count, never a guess', () => {
    const counts = { ...ZERO, overdue: 2, meetings_today: 1 }
    expect(tabCounts(summary({ counts, partial: ['tasks'] }))).toEqual({
      calendar: { n: 1, key: 'wbTabCountMeetings', tone: 'muted' },
    })
    expect(tabCounts(summary({ counts, partial: ['meetings'] }))).toEqual({
      tasks: { n: 2, key: 'wbTabCountOverdue', tone: 'danger' },
    })
    expect(tabCounts(summary({ counts: { ...ZERO, overdue: null, due_today: 3 } }))).toEqual({})
  })
})

describe('myWorkGroups', () => {
  it('Overdue, Today, then Upcoming (later and no due date), each in list order', () => {
    const groups = myWorkGroups(
      [
        task({ id: 'a', due_date: '2026-10-20' }),
        task({ id: 'b' }),
        task({ id: 'c', due_date: TODAY }),
        task({ id: 'd', due_date: undefined }),
      ],
      TODAY,
    )
    expect(groups.map((g) => [g.key, g.tasks.map((x) => x.id)])).toEqual([
      ['overdue', ['b']],
      ['today', ['c']],
      ['upcoming', ['a', 'd']],
    ])
  })

  it('a ticked task keeps its due group instead of jumping to Upcoming', () => {
    const done = task({ status: 'done' })
    expect(myWorkGroups([done], TODAY)).toEqual([{ key: 'overdue', tasks: [done] }])
  })

  it('no tasks, no groups', () => {
    expect(myWorkGroups([], TODAY)).toEqual([])
  })
})

describe('formatDay', () => {
  it('writes a long day in sentence case: only the first letter capitalised', () => {
    expect(formatDay('2026-10-14', 'vi', true)).toBe('Thứ Tư, 14 tháng 10')
    expect(formatDay('2026-10-14', 'fr', true)).toBe('Mercredi 14 octobre')
    expect(formatDay('2026-10-14', 'en', true)).toBe('Wednesday, October 14')
  })
  it('leaves the short form as the locale writes it', () => {
    expect(formatDay('2026-10-14', 'fr', false)).toBe('14 oct.')
  })
})
