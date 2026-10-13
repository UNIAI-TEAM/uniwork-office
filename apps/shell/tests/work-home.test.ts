import { describe, expect, it } from 'vitest'
import type { RecentEntry, UniworkDocSummary } from '../src/shared/home-api'
import type {
  WorkHomeSummary,
  WorkMeeting,
  WorkNotification,
  WorkTask,
} from '../src/shared/uniwork-work-api'
import {
  buildHeadline,
  dueState,
  greetingKey,
  greetingName,
  hourIn,
  inboxTarget,
  isQuiet,
  localDay,
  mergeRecentDocuments,
  notificationKey,
  overdueDays,
  overviewView,
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

function meeting(over: Partial<WorkMeeting> = {}): WorkMeeting {
  return {
    id: 'm1',
    workspace_id: 'w',
    title: 'Weekly sync',
    starts_at: '2026-10-13T08:00:00Z',
    ends_at: '2026-10-13T09:00:00Z',
    status: 'SCHEDULED',
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

function note(over: Partial<WorkNotification> = {}): WorkNotification {
  return {
    id: 'n1',
    kind: 'task_assigned',
    workspace_id: 'w',
    resource_type: 'task',
    resource_id: 't9',
    actor_kind: 'user',
    title_key: 'notifications.kind.task_assigned',
    params: {},
    created_at: '2026-10-13T01:00:00Z',
    ...over,
  }
}

describe('greetingKey', () => {
  it.each([
    [0, 'wbOvGreetingMorning'],
    [10, 'wbOvGreetingMorning'],
    [11, 'wbOvGreetingNoon'],
    [13, 'wbOvGreetingNoon'],
    [14, 'wbOvGreetingAfternoon'],
    [17, 'wbOvGreetingAfternoon'],
    [18, 'wbOvGreetingEvening'],
    [23, 'wbOvGreetingEvening'],
  ] as const)('hour %i → %s', (hour, key) => {
    expect(greetingKey(hour)).toBe(key)
  })
})

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

describe('hourIn', () => {
  it('reads the hour in the summary zone', () => {
    expect(hourIn('Asia/Ho_Chi_Minh', new Date('2026-10-13T02:30:00Z'))).toBe(9)
  })
  it('falls back to the device clock for an unknown zone', () => {
    const now = new Date('2026-10-13T02:30:00Z')
    expect(hourIn('Not/AZone', now)).toBe(now.getHours())
  })
})

describe('buildHeadline (port of uniwork core/home/brief.ts)', () => {
  it('puts a live meeting first and carries its id', () => {
    const h = buildHeadline(
      summary({
        counts: { ...ZERO, overdue: 1 },
        partial: ['notifications'],
        upcoming_meetings: [meeting({ status: 'IN_PROGRESS' })],
      }),
    )
    expect(h).toEqual({
      key: 'wbOvHeadlineLive',
      params: { title: 'Weekly sync' },
      liveMeetingId: 'm1',
    })
  })
  it('then a failed source, because its zeros are not true', () => {
    expect(
      buildHeadline(summary({ counts: { ...ZERO, overdue: 1 }, partial: ['tasks'] })).key,
    ).toBe('wbOvHeadlinePartial')
  })
  it('then the oldest open overdue task with its days late', () => {
    const h = buildHeadline(
      summary({
        counts: { ...ZERO, overdue: 2 },
        my_work: [task({ id: 'done', status: 'done', due_date: '2026-10-01' }), task()],
      }),
    )
    expect(h).toEqual({
      key: 'wbOvHeadlineOverdue',
      params: { title: 'Send the contract', count: 3 },
    })
  })
  it('counts overdue work that is not in the list', () => {
    expect(buildHeadline(summary({ counts: { ...ZERO, overdue: 2 } }))).toEqual({
      key: 'wbOvHeadlineOverduePlain',
      params: { count: 2 },
    })
  })
  it('then the next meeting of today, with its start to format', () => {
    const h = buildHeadline(
      summary({ counts: { ...ZERO, meetings_today: 1 }, upcoming_meetings: [meeting()] }),
    )
    expect(h).toEqual({
      key: 'wbOvHeadlineMeeting',
      params: { title: 'Weekly sync' },
      at: '2026-10-13T08:00:00Z',
    })
  })
  it('then due today, then unread, then a clear day', () => {
    expect(buildHeadline(summary({ counts: { ...ZERO, due_today: 2, unread: 1 } })).key).toBe(
      'wbOvHeadlineDueToday',
    )
    expect(buildHeadline(summary({ counts: { ...ZERO, unread: 4 } }))).toEqual({
      key: 'wbOvHeadlineUnread',
      params: { count: 4 },
    })
    expect(buildHeadline(summary()).key).toBe('wbOvHeadlineClear')
  })
  it('treats a count the server sent malformed (null) like a failed source', () => {
    expect(buildHeadline(summary({ counts: { ...ZERO, unread: null } })).key).toBe(
      'wbOvHeadlinePartial',
    )
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

describe('isQuiet and withTaskStatus', () => {
  it('is quiet only when nothing waits and every source answered', () => {
    expect(isQuiet(summary())).toBe(true)
    expect(isQuiet(summary({ partial: ['tasks'] }))).toBe(false)
    expect(isQuiet(summary({ my_work: [task()] }))).toBe(false)
    expect(isQuiet(summary({ counts: { ...ZERO, open: null } }))).toBe(false)
  })
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

describe('notificationKey and inboxTarget', () => {
  it('uses the desktop sentence of a known kind, else the fallback', () => {
    expect(notificationKey('task_assigned')).toBe('wbNotif_task_assigned')
    expect(notificationKey('something_new')).toBe('wbNotifFallback')
    expect(notificationKey('constructor')).toBe('wbNotifFallback')
  })
  it('opens a task or a meeting on the web, anything else in the web inbox', () => {
    const ws = { orgSlug: 'acme', wsSlug: 'team' }
    expect(inboxTarget(note(), ws)).toEqual({
      kind: 'task',
      orgSlug: 'acme',
      wsSlug: 'team',
      id: 't9',
    })
    expect(inboxTarget(note({ resource_type: 'meeting', resource_id: 'm2' }), ws)).toEqual({
      kind: 'meeting',
      orgSlug: 'acme',
      wsSlug: 'team',
      id: 'm2',
    })
    expect(inboxTarget(note({ resource_type: 'document' }), ws)).toEqual({
      kind: 'inbox',
      orgSlug: 'acme',
      wsSlug: 'team',
    })
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

describe('the summary zone decides today near midnight', () => {
  it('a meeting just after midnight in the user zone is tomorrow, not today’s headline', () => {
    // 11:30 UTC on the 13th is 00:30 on the 14th in Auckland (UTC+13), but still the 13th
    // on any device clock from UTC−11 to UTC+12 (Ho Chi Minh City included)
    expect(localDay('2026-10-13T11:30:00Z', 'Pacific/Auckland')).toBe('2026-10-14')
    const h = buildHeadline(
      summary({
        timezone: 'Pacific/Auckland',
        counts: { ...ZERO, meetings_today: 1, unread: 2 },
        upcoming_meetings: [meeting({ starts_at: '2026-10-13T11:30:00Z' })],
      }),
    )
    expect(h).toEqual({ key: 'wbOvHeadlineUnread', params: { count: 2 } })
  })
})
