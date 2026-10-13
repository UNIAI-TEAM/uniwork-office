/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HomeApi,
  RecentEntry,
  UniworkDocSummary,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import type { UniworkWorkApi, WorkHomeSummary, WorkTask } from '../src/shared/uniwork-work-api'
import { afterWorkspaceList } from '../src/renderer/src/active-workspace'
import { LocaleProvider } from '../src/renderer/src/locale'
import { cacheWork, cachedWorkspaceListState, workCacheSlot } from '../src/renderer/src/work-cache'
import { WorkOverview } from '../src/renderer/src/WorkOverview'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

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

function summary(over: Partial<WorkHomeSummary> = {}): WorkHomeSummary {
  return {
    today: TODAY,
    timezone: 'Asia/Ho_Chi_Minh',
    counts: { open: 4, overdue: 1, due_today: 2, meetings_today: 1, unread: 3 },
    my_work: [task()],
    upcoming_meetings: [
      {
        id: 'm1',
        workspace_id: 'w',
        title: 'Weekly sync',
        starts_at: '2026-10-13T02:00:00Z',
        ends_at: '2026-10-13T03:00:00Z',
        status: 'IN_PROGRESS',
      },
    ],
    inbox: [
      {
        id: 'n1',
        kind: 'task_assigned',
        workspace_id: 'w',
        resource_type: 'task',
        resource_id: 't9',
        actor_kind: 'user',
        title_key: 'notifications.kind.task_assigned',
        params: { actor: 'Linh', task: 'Draft the quote' },
        created_at: '2026-10-13T01:00:00Z',
      },
    ],
    partial: [],
    generated_at: '2026-10-13T03:00:00Z',
    ...over,
  }
}

const CLOUD: UniworkDocSummary = {
  id: 'd1',
  workspaceId: 'w',
  title: 'Plan.docx',
  format: 'docx',
  updatedAt: '2026-10-12T09:00:00Z',
}
const LOCAL = {
  path: '/docs/notes.docx',
  name: 'notes.docx',
  ext: 'docx',
  mtimeMs: Date.parse('2026-10-11T09:00:00Z'),
  sizeBytes: 10,
  starred: false,
} as RecentEntry

let host: HTMLDivElement
let root: Root
let work: {
  homeSummary: ReturnType<typeof vi.fn<UniworkWorkApi['homeSummary']>>
  setTaskStatus: ReturnType<typeof vi.fn<UniworkWorkApi['setTaskStatus']>>
  openWeb: ReturnType<typeof vi.fn<UniworkWorkApi['openWeb']>>
}
let api: Record<string, ReturnType<typeof vi.fn>>
let wsSeq = 0

// each test gets its own workspace id: the summary cache lives at module level
function workspace(): UniworkWorkspaceRef {
  wsSeq += 1
  return { id: `w${wsSeq}`, name: 'Team', orgId: 'o1', slug: 'team', orgSlug: 'acme' }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  work = {
    homeSummary: vi.fn<UniworkWorkApi['homeSummary']>(async () => ({ ok: true, value: summary() })),
    setTaskStatus: vi.fn<UniworkWorkApi['setTaskStatus']>(async () => ({
      ok: true,
      value: task({ status: 'done' }),
    })),
    openWeb: vi.fn<UniworkWorkApi['openWeb']>(async () => true),
  }
  window.uniworkWork = work as unknown as UniworkWorkApi
  api = {
    accountStatus: vi.fn(async () => ({
      loggedIn: true,
      state: 'signed-in',
      profile: { accountId: 'u1', email: 'linh@acme.vn', displayName: 'Linh' },
    })),
    accountLogin: vi.fn(async () => true),
    recents: vi.fn(async () => ({ entries: [LOCAL], total: 1, totalAll: 1 })),
    uniworkListDocuments: vi.fn(async () => ({
      ok: true,
      value: { documents: [CLOUD], nextCursor: null },
    })),
    uniworkOpenDocument: vi.fn(async () => ({ ok: true, value: { path: '/w/Plan.docx' } })),
    openPath: vi.fn(async () => undefined),
    setLanguage: vi.fn(async () => undefined),
  }
  window.aiOffice = api as unknown as HomeApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

type Props = Parameters<typeof WorkOverview>[0]

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function render(props: Props): Promise<void> {
  await act(async () => {
    root.render(
      createElement(LocaleProvider, { initial: 'en' }, createElement(WorkOverview, props)),
    )
  })
  await flush()
}

async function mount(over: Partial<Props> = {}): Promise<Props> {
  const ws = workspace()
  const props: Props = {
    workspaces: [ws],
    workspaceId: ws.id,
    workspaceError: null,
    refreshTick: 0,
    onReload: vi.fn(),
    onCompose: vi.fn(),
    ...over,
  }
  await render(props)
  return props
}

async function click(el: Element | undefined): Promise<void> {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

const text = () => host.textContent ?? ''
const buttons = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
    (b) => b.textContent?.trim() === label,
  )
const stat = (key: string) => host.querySelector(`[data-testid="wb-stat-${key}"]`)?.textContent

describe('WorkOverview', () => {
  it('full: greeting, headline, five counts, my work, a live meeting, the inbox and recents', async () => {
    const props = await mount()
    expect(host.querySelector('.wb-ov-greeting')?.textContent).toContain('Linh')
    expect(text()).toContain('“Weekly sync” is in progress.')
    expect(['open', 'overdue', 'due_today', 'meetings_today', 'unread'].map(stat)).toEqual([
      '4',
      '1',
      '2',
      '1',
      '3',
    ])
    expect(text()).toContain('Send the contract')
    expect(text()).toContain('OPS-7')
    expect(text()).toContain('Days overdue: 3')
    expect(text()).toContain('Linh assigned you “Draft the quote”')
    expect(text()).toContain('Plan.docx')
    expect(text()).toContain('notes.docx')
    expect(text()).toContain('On this device')
    expect(api.uniworkListDocuments).toHaveBeenCalledWith({
      workspaceId: props.workspaceId,
      limit: 20,
    })

    await click(buttons('Join')[0])
    expect(work.openWeb).toHaveBeenCalledWith({
      kind: 'room',
      orgSlug: 'acme',
      wsSlug: 'team',
      id: 'm1',
    })

    const cloudCard = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Plan.docx'),
    )
    await click(cloudCard)
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d1')
  })

  it('partial: the failed source shows a dash and Retry, never a zero', async () => {
    work.homeSummary.mockResolvedValue({
      ok: true,
      value: summary({
        partial: ['meetings'],
        counts: { open: 4, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 },
        upcoming_meetings: [],
        inbox: [],
      }),
    })
    await mount()
    expect(stat('meetings_today')).toBeUndefined()
    expect(text()).toContain('—')
    expect(text()).toContain('Part of your data did not load')
    expect(text()).toContain('Couldn’t load')
    await click(buttons('Retry')[0])
    expect(work.homeSummary).toHaveBeenCalledTimes(2)
  })

  it('quiet: one line and a shortcut to Compose instead of empty lists', async () => {
    work.homeSummary.mockResolvedValue({
      ok: true,
      value: summary({
        counts: { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 },
        my_work: [],
        upcoming_meetings: [],
        inbox: [],
      }),
    })
    const props = await mount()
    expect(text()).toContain('Nothing is waiting for you')
    expect(host.querySelector('.wb-ov-stats')).toBeNull()
    await click(buttons('Compose')[0])
    expect(props.onCompose).toHaveBeenCalledTimes(1)
  })

  it('signed out: one sign-in panel and only this device’s recents', async () => {
    await mount({ workspaces: [], workspaceId: null, workspaceError: 'signed-out' })
    expect(work.homeSummary).not.toHaveBeenCalled()
    expect(api.uniworkListDocuments).not.toHaveBeenCalled()
    expect(text()).toContain('Sign in to see your work')
    expect(text()).toContain('notes.docx')
    expect(text()).toContain('On this device')
    await click(buttons('Sign in to UniWork')[0])
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
  })

  it('offline after a load: keeps the cached data and says when it was updated', async () => {
    const props = await mount()
    expect(text()).toContain('Send the contract')
    work.homeSummary.mockResolvedValueOnce({ ok: false, error: 'offline' })
    // an offline Refresh: the list fails too (Task 12 keeps the workspace) and so does the summary
    await render({ ...props, workspaceError: 'offline', refreshTick: 1 })
    expect(work.homeSummary).toHaveBeenCalledTimes(2)
    expect(text()).toContain('Send the contract')
    expect(text()).toContain('Updated at')
  })

  it('offline re-entry: a remount starts from the cached list and shows the cached summary', async () => {
    const props = await mount()
    expect(text()).toContain('Send the contract')
    // PracticeHome caches the list on every load and remounts when the user comes back
    cacheWork(workCacheSlot('workspaces'), props.workspaces)
    act(() => root.unmount())
    root = createRoot(host)
    work.homeSummary.mockResolvedValueOnce({ ok: false, error: 'offline' })
    const seeded = cachedWorkspaceListState()
    expect(seeded.workspaceId).toBe(props.workspaceId)
    const offline = afterWorkspaceList(seeded, { ok: false, error: 'network' }, null)
    await render({ ...props, ...offline })
    expect(text()).toContain('Send the contract')
    expect(text()).toContain('Updated at')
    expect(text()).not.toContain('Couldn’t reach UniWork')
  })

  it('offline with nothing cached: an empty state with Retry', async () => {
    work.homeSummary.mockResolvedValue({ ok: false, error: 'offline' })
    const props = await mount()
    expect(text()).toContain('Couldn’t reach UniWork')
    await click(buttons('Retry')[0])
    expect(props.onReload).toHaveBeenCalledTimes(1)
  })

  it('forbidden: says access was lost and suggests another workspace', async () => {
    work.homeSummary.mockResolvedValue({ ok: false, error: 'forbidden' })
    await mount()
    expect(text()).toContain('You no longer have access to this workspace')
    expect(text()).not.toContain('Send the contract')
  })

  it('done checkbox: stays checked and reloads the summary when the server accepts', async () => {
    work.homeSummary.mockResolvedValueOnce({ ok: true, value: summary() }).mockResolvedValueOnce({
      ok: true,
      value: summary({
        counts: { open: 3, overdue: 0, due_today: 2, meetings_today: 1, unread: 3 },
        my_work: [task({ status: 'done' })],
      }),
    })
    await mount()
    await click(host.querySelector('input[type="checkbox"]') ?? undefined)
    expect(work.setTaskStatus).toHaveBeenCalledWith('t1', 'done')
    expect(work.homeSummary).toHaveBeenCalledTimes(2)
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true)
    expect(stat('open')).toBe('3')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('done checkbox: rolls back and offers Retry when the server refuses', async () => {
    work.setTaskStatus.mockResolvedValue({ ok: false, error: 'server' })
    await mount()
    await click(host.querySelector('input[type="checkbox"]') ?? undefined)
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    const alert = host.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('Couldn’t update the task')
    await click(buttons('Retry').find((b) => alert.contains(b)))
    expect(work.setTaskStatus).toHaveBeenCalledTimes(2)
    expect(work.setTaskStatus).toHaveBeenLastCalledWith('t1', 'done')
  })

  it('a count the server sent malformed shows a dash and Retry, never a zero', async () => {
    work.homeSummary.mockResolvedValue({
      ok: true,
      value: summary({
        counts: { open: 4, overdue: 1, due_today: 2, meetings_today: 1, unread: null },
      }),
    })
    await mount()
    expect(stat('unread')).toBeUndefined()
    expect(stat('open')).toBe('4')
    expect(text()).toContain('—')
    await click(buttons('Retry')[0])
    expect(work.homeSummary).toHaveBeenCalledTimes(2)
  })

  it('reloads when the window regains focus and every 60 s while visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      await mount()
      expect(work.homeSummary).toHaveBeenCalledTimes(1)
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      await flush()
      expect(work.homeSummary).toHaveBeenCalledTimes(2)
      await act(async () => {
        vi.advanceTimersByTime(60_000)
      })
      await flush()
      expect(work.homeSummary).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
