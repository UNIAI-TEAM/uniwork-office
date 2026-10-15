/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requirePractice } from '@uniwork/practice-core'
import type { HomeApi, UniworkWorkspaceRef } from '../src/shared/home-api'
import type {
  UniworkWorkApi,
  WorkHomeSummary,
  WorkTask,
  WorkTaskStatus,
} from '../src/shared/uniwork-work-api'

const store = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/renderer/src/workbench-store-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/workbench-store-client')>()),
  wbStoreGetRaw: (key: string) => store.get(key) ?? null,
  wbStoreSetRaw: (key: string, value: string) => {
    store.set(key, value)
  },
  wbStoreRemove: (key: string) => {
    store.delete(key)
  },
  wbStoreRead: <T>(key: string, fallback: T): T => {
    const raw = store.get(key)
    return raw === undefined ? fallback : (JSON.parse(raw) as T)
  },
  wbStoreWrite: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value))
  },
}))

import { LocaleProvider } from '../src/renderer/src/locale'
import { PracticeHome } from '../src/renderer/src/PracticeHome'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS: UniworkWorkspaceRef = {
  id: 'w-counts',
  name: 'Ops',
  orgId: 'o1',
  slug: 'ops',
  orgSlug: 'acme',
}
const SUMMARY: WorkHomeSummary = {
  today: '2026-10-13',
  timezone: 'Asia/Ho_Chi_Minh',
  counts: { open: 4, overdue: 2, due_today: 1, meetings_today: 1, unread: 0 },
  my_work: [],
  upcoming_meetings: [],
  inbox: [],
  partial: [],
  generated_at: '2026-10-13T03:00:00Z',
}

let host: HTMLDivElement
let root: Root
let land: (value: unknown) => void

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function renderHome(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(PracticeHome, {
          practice: requirePractice('entrepreneur'),
          projects: [],
          selectedId: null,
          onSelectPack: vi.fn(),
          onOpenPackFiles: vi.fn(),
          onRefresh: vi.fn(),
          onSwitchPractice: vi.fn(),
          newItems: [],
        }),
      ),
    )
  })
  await flush()
}

const tabCount = (label: string) =>
  Array.from(host.querySelectorAll('.wb-tab-module'))
    .find((b) => b.textContent?.includes(label))
    ?.querySelector('.wb-tab-count')?.textContent ?? null

beforeEach(() => {
  store.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  window.aiOffice = {
    uniworkListWorkspaces: vi.fn(async () => ({ ok: true, value: [WS] })),
    accountStatus: vi.fn(async () => ({
      loggedIn: true,
      state: 'signed-in',
      profile: { accountId: 'u1', email: 'linh@acme.vn', displayName: 'Linh' },
    })),
    accountLogin: vi.fn(async () => true),
    recents: vi.fn(async () => ({ entries: [], total: 0, totalAll: 0 })),
    uniworkListDocuments: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    uniworkListSharedWithMe: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    uniworkDocStatus: vi.fn(async () => null),
    onUniworkDocStatus: vi.fn(() => () => undefined),
    listDrafts: vi.fn(async () => []),
    setLanguage: vi.fn(async () => undefined),
  } as unknown as HomeApi
  window.uniworkWork = {
    homeSummary: vi.fn(() => new Promise((resolve) => (land = resolve))),
    setTaskStatus: vi.fn(),
    openWeb: vi.fn(async () => true),
  } as unknown as UniworkWorkApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Workbench tab counts follow the Desk summary', () => {
  it('no count before the summary lands; the counts appear when it does, without a tab switch', async () => {
    await renderHome()
    expect(window.uniworkWork.homeSummary).toHaveBeenCalled()
    expect(host.querySelector('.wb-tab-count')).toBeNull()
    await act(async () => land({ ok: true, value: SUMMARY }))
    await flush()
    const counts = Array.from(host.querySelectorAll('.wb-tab-count')).map((c) => [
      c.textContent,
      c.classList.contains('is-danger'),
    ])
    expect(counts).toEqual([
      ['2', true],
      ['1', false],
    ])
  })
  it('a task ticked done in the Tasks tab reloads the summary, and the tab count follows', async () => {
    const overdue: WorkTask = {
      id: 't1',
      workspace_id: WS.id,
      identifier: 'OPS-7',
      title: 'Send the quote',
      status: 'todo',
      priority: 'medium',
      due_date: '2026-10-01',
      updated_at: '2026-10-01T08:00:00Z',
    }
    const statuses: WorkTaskStatus[] = [
      { id: 's1', key: 'todo', name: 'To do', category: 'todo', color: '', position: 1 },
      { id: 's2', key: 'done', name: 'Done', category: 'done', color: '', position: 2 },
    ]
    Object.assign(window.uniworkWork, {
      myTasks: vi.fn(async () => ({ ok: true, value: [overdue] })),
      taskStatuses: vi.fn(async () => ({ ok: true, value: statuses })),
      setTaskStatus: vi.fn(async (_id: string, status: string) => ({
        ok: true,
        value: { ...overdue, status },
      })),
    })
    await renderHome()
    await act(async () => land({ ok: true, value: SUMMARY }))
    await flush()
    expect(tabCount('Tasks')).toBe('2')

    const tasksTab = Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-tab-module')).find(
      (b) => b.textContent?.includes('Tasks'),
    )
    await act(async () => tasksTab?.click())
    await flush()
    const box = host.querySelector<HTMLInputElement>('.wb-work-row input[type="checkbox"]')
    expect(box).not.toBeNull()
    const calls = vi.mocked(window.uniworkWork.homeSummary).mock.calls.length
    await act(async () => box?.click())
    await flush()
    expect(window.uniworkWork.setTaskStatus).toHaveBeenCalledWith('t1', 'done')
    expect(vi.mocked(window.uniworkWork.homeSummary).mock.calls.length).toBe(calls + 1)
    await act(async () =>
      land({ ok: true, value: { ...SUMMARY, counts: { ...SUMMARY.counts, overdue: 1 } } }),
    )
    await flush()
    expect(tabCount('Tasks')).toBe('1')
  })

  const quickAdd = async (title: string) => {
    const input = host.querySelector<HTMLInputElement>('.wb-work-quick input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, title)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      host
        .querySelector('.wb-work-quick')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
  }

  const openTasksTab = async () => {
    const tasksTab = Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-tab-module')).find(
      (b) => b.textContent?.includes('Tasks'),
    )
    await act(async () => tasksTab?.click())
    await flush()
  }

  const withTasksApi = () => {
    let n = 0
    Object.assign(window.uniworkWork, {
      myTasks: vi.fn(async () => ({ ok: true, value: [] })),
      taskStatuses: vi.fn(async () => ({ ok: true, value: [] })),
      createTask: vi.fn(async (input: { workspaceId: string; title: string }) => ({
        ok: true,
        value: {
          id: `n${++n}`,
          workspace_id: input.workspaceId,
          identifier: `OPS-${n}`,
          title: input.title,
          status: 'todo',
          priority: 'medium',
          updated_at: '2026-10-13T08:00:00Z',
        },
      })),
    })
  }

  it('a quick add in the Tasks tab reloads the summary once', async () => {
    withTasksApi()
    await renderHome()
    await act(async () => land({ ok: true, value: SUMMARY }))
    await flush()
    await openTasksTab()
    const calls = vi.mocked(window.uniworkWork.homeSummary).mock.calls.length
    await quickAdd('Call the bank')
    expect(window.uniworkWork.createTask).toHaveBeenCalledTimes(1)
    expect(vi.mocked(window.uniworkWork.homeSummary).mock.calls.length).toBe(calls + 1)
  })

  it('two quick writes: an older summary landing last never replaces the newer one', async () => {
    withTasksApi()
    await renderHome()
    await act(async () => land({ ok: true, value: SUMMARY }))
    await flush()
    await openTasksTab()
    await quickAdd('First')
    const landFirst = land
    await quickAdd('Second')
    const landSecond = land
    expect(landSecond).not.toBe(landFirst)
    const withOverdue = (overdue: number) => ({
      ok: true,
      value: { ...SUMMARY, counts: { ...SUMMARY.counts, overdue } },
    })
    await act(async () => landSecond(withOverdue(5)))
    await flush()
    expect(tabCount('Tasks')).toBe('5')
    await act(async () => landFirst(withOverdue(3)))
    await flush()
    expect(tabCount('Tasks')).toBe('5')
  })
})
