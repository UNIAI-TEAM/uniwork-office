/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import type { UniworkWorkApi, WorkHomeSummary, WorkTask } from '../src/shared/uniwork-work-api'
import { DeskToday } from '../src/renderer/src/DeskToday'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { WorkLoad } from '../src/renderer/src/work-cache'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS: UniworkWorkspaceRef = {
  id: 'w',
  name: 'Team',
  orgId: 'o1',
  slug: 'team',
  orgSlug: 'acme',
} as UniworkWorkspaceRef
const task = (over: Partial<WorkTask> = {}): WorkTask => ({
  id: 't1',
  workspace_id: 'w',
  identifier: 'OPS-7',
  title: 'Send the contract',
  status: 'todo',
  priority: 'high',
  due_date: '2026-10-10',
  updated_at: '2026-10-10T08:00:00Z',
  ...over,
})
const summary = (over: Partial<WorkHomeSummary> = {}): WorkHomeSummary => ({
  today: '2026-10-13',
  timezone: 'Asia/Ho_Chi_Minh',
  counts: { open: 3, overdue: 1, due_today: 1, meetings_today: 1, unread: 2 },
  my_work: [
    task(),
    task({ id: 't2', title: 'Approve leave', due_date: '2026-10-13' }),
    task({ id: 't3', title: 'Later', due_date: '2026-10-20' }),
  ],
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
      title_key: 'x',
      params: {},
      created_at: '2026-10-13T01:00:00Z',
    },
    {
      id: 'n2',
      kind: 'document_commented',
      workspace_id: 'w',
      resource_type: 'document',
      resource_id: 'd1',
      actor_kind: 'user',
      title_key: 'x',
      params: {},
      created_at: '2026-10-13T01:00:00Z',
    },
  ],
  partial: [],
  generated_at: '2026-10-13T03:00:00Z',
  ...over,
})

let host: HTMLDivElement
let root: Root
let work: { setTaskStatus: ReturnType<typeof vi.fn>; openWeb: ReturnType<typeof vi.fn> }

function load(value: WorkHomeSummary | null): WorkLoad<WorkHomeSummary> {
  return { value, updatedAt: 1, error: null, stale: false, reload: vi.fn(), update: vi.fn() }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  work = {
    setTaskStatus: vi.fn(async () => ({ ok: true, value: task({ status: 'done' }) })),
    openWeb: vi.fn(async () => true),
  }
  window.uniworkWork = work as unknown as UniworkWorkApi
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(props: Parameters<typeof DeskToday>[0]) {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(DeskToday, props)))
  })
}
const base = (home: WorkLoad<WorkHomeSummary>) => ({
  home,
  view: 'ready' as const,
  workspace: WS,
  workspaceError: null,
  onReload: vi.fn(),
  onOpenTasks: vi.fn(),
})
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes(label))

describe('DeskToday', () => {
  it('lists overdue and today tasks only, the live meeting and the other notifications', async () => {
    await render(base(load(summary())))
    const text = host.textContent ?? ''
    expect(text).toContain('Send the contract')
    expect(text).toContain('Approve leave')
    expect(text).not.toContain('Later')
    expect(text).toContain('Weekly sync')
    // the document comment belongs to the tray; one other notification is left
    expect(text).toContain('Other notifications (1)')
    // a note line, not a bare flex child that stretches and inherits the column's font
    expect(button('Other notifications')!.parentElement!.className).toBe('wb-ov-note')
    await act(async () => button('Other notifications')!.click())
    expect(work.openWeb).toHaveBeenCalledWith({ kind: 'inbox', orgSlug: 'acme', wsSlug: 'team' })
  })

  it('counts other notifications from the unread total, not the capped inbox preview', async () => {
    const s = summary()
    await render(base(load({ ...s, counts: { ...s.counts, unread: 30 } })))
    expect(host.textContent).toContain('Other notifications (29)')
  })

  it('ticks a task through the server and reloads; a refusal puts it back and offers Retry', async () => {
    const home = load(summary())
    await render(base(home))
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => box.click())
    expect(work.setTaskStatus).toHaveBeenCalledWith('t1', 'done')
    expect(home.reload).toHaveBeenCalled()

    work.setTaskStatus.mockResolvedValueOnce({ ok: false, error: 'server' })
    await act(async () => box.click())
    expect(home.update).toHaveBeenCalledTimes(3)
    expect(host.querySelector('.wb-toast')).not.toBeNull()
  })

  it('says when nothing is due, and opens the Tasks tab from "All tasks"', async () => {
    const props = base(load(summary({ my_work: [] })))
    await render(props)
    expect(host.textContent).toContain('Nothing due today.')
    await act(async () => button('All tasks')!.click())
    expect(props.onOpenTasks).toHaveBeenCalled()
  })

  it('shows the sign-in panel in its column when signed out', async () => {
    await render({
      ...base(load(null)),
      view: 'signed-out',
      workspace: null,
      workspaceError: 'signed-out',
    })
    expect(host.querySelector('.wb-state')).not.toBeNull()
    expect(host.textContent).toContain('Today')
  })
})
