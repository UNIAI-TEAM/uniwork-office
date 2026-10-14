/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import type {
  UniworkWorkError,
  UniworkWorkResult,
  WorkTask,
  WorkTaskStatus,
} from '../src/shared/uniwork-work-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WbToastHost, createWbToasts } from '../src/renderer/src/WbToastHost'
import { WorkTasksPane } from '../src/renderer/src/WorkTasksPane'
import { WB_REFRESH_EVENT } from '../src/renderer/src/work-cache'
import { localIsoDate } from '../src/renderer/src/work-tasks'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS: UniworkWorkspaceRef = { id: 'w1', name: 'Ops', orgId: 'o1', slug: 'ops', orgSlug: 'acme' }
const TASK: WorkTask = {
  id: 't1',
  workspace_id: 'w1',
  identifier: 'OPS-7',
  title: 'Send the quote',
  status: 'todo',
  priority: 'medium',
  due_date: localIsoDate(new Date()),
  updated_at: '2026-10-13T08:00:00Z',
}
const STATUSES: WorkTaskStatus[] = [
  { id: 's1', key: 'todo', name: 'To do', category: 'todo', color: '', position: 1 },
  { id: 's2', key: 'done', name: 'Done', category: 'done', color: '', position: 2 },
]

function makeApi() {
  return {
    homeSummary: vi.fn(),
    myTasks: vi.fn(async (): Promise<UniworkWorkResult<WorkTask[]>> => ({
      ok: true,
      value: [TASK],
    })),
    taskStatuses: vi.fn(async (): Promise<UniworkWorkResult<WorkTaskStatus[]>> => ({
      ok: true,
      value: STATUSES,
    })),
    setTaskStatus: vi.fn(
      async (_id: string, status: string): Promise<UniworkWorkResult<WorkTask>> => ({
        ok: true,
        value: { ...TASK, status },
      }),
    ),
    createTask: vi.fn(),
    calendarEvents: vi.fn(),
    myProfile: vi.fn(),
    openWeb: vi.fn(async () => true),
  }
}

let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof makeApi>
let onReload: ReturnType<typeof vi.fn>

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function render(
  workspace: UniworkWorkspaceRef | null,
  workspaceError: UniworkWorkError | null = null,
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(
          WbToastHost,
          { toasts: createWbToasts() },
          createElement(WorkTasksPane, { workspace, workspaceError, onReload }),
        ),
      ),
    )
  })
  await flush()
}

// the work cache lives at module level: tests that must start with nothing cached use their own workspace id
async function mount(workspace: UniworkWorkspaceRef = WS): Promise<void> {
  await render(workspace)
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const checkbox = () => host.querySelector<HTMLInputElement>('.wb-work-row input[type="checkbox"]')!
const buttonByText = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = makeApi()
  onReload = vi.fn()
  ;(window as unknown as { uniworkWork: unknown }).uniworkWork = api
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Tasks tab', () => {
  it('lists the task under Today with its key, status name and due pill', async () => {
    await mount()
    expect(api.myTasks).toHaveBeenCalledWith('w1')
    const text = host.textContent ?? ''
    expect(text).toContain('Today')
    expect(text).toContain('Send the quote')
    expect(text).toContain('OPS-7')
    expect(text).toContain('To do')
  })

  it('ticking the checkbox sets the status to done', async () => {
    await mount()
    await click(checkbox())
    expect(api.setTaskStatus).toHaveBeenCalledWith('t1', 'done')
    expect(checkbox().checked).toBe(true)
    expect(host.querySelector('.wb-work-row')!.classList.contains('is-done')).toBe(true)
  })

  it('a failed save puts the checkbox back and offers Retry in a toast', async () => {
    api.setTaskStatus.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await mount()
    await click(checkbox())
    expect(checkbox().checked).toBe(false)
    const toast = host.querySelector('.wb-toast[role="alert"]')
    expect(toast?.textContent).toContain('Could not save the change.')
    await click(buttonByText('Retry'))
    expect(api.setTaskStatus).toHaveBeenCalledTimes(2)
    expect(checkbox().checked).toBe(true)
  })

  it('quick add retries with the same idempotency key', async () => {
    api.createTask
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce({ ok: true, value: { ...TASK, id: 't2', title: 'Call the bank' } })
    await mount()
    const input = host.querySelector<HTMLInputElement>('.wb-work-quick input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Call the bank',
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
    await click(buttonByText('Retry'))
    expect(api.createTask).toHaveBeenCalledTimes(2)
    const first = api.createTask.mock.calls[0]![0]
    const second = api.createTask.mock.calls[1]![0]
    expect(first).toEqual({
      workspaceId: 'w1',
      title: 'Call the bank',
      idempotencyKey: expect.any(String),
    })
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    expect(host.textContent).toContain('Call the bank')
  })

  it('a late answer for the previous workspace never replaces the new one', async () => {
    let releaseOld: (r: UniworkWorkResult<WorkTask[]>) => void = () => undefined
    api.myTasks.mockImplementationOnce(
      () =>
        new Promise<UniworkWorkResult<WorkTask[]>>((resolve) => {
          releaseOld = resolve
        }),
    )
    await mount({ ...WS, id: 'w-old' })
    api.myTasks.mockResolvedValueOnce({
      ok: true,
      value: [{ ...TASK, id: 't2', workspace_id: 'w-new', title: 'Second workspace task' }],
    })
    await render({ ...WS, id: 'w-new', slug: 'new' })
    releaseOld({ ok: true, value: [TASK] })
    await flush()
    expect(host.textContent).toContain('Second workspace task')
    expect(host.textContent).not.toContain('Send the quote')
  })

  it('offline on first load with nothing cached: an error with Retry, then the list', async () => {
    api.myTasks.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await mount({ ...WS, id: 'w-fresh' })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t reach UniWork')
    expect(host.querySelector('.wb-work-skeleton')).toBeNull()
    await click(buttonByText('Retry'))
    expect(host.textContent).toContain('Send the quote')
  })

  it('a rejected bridge call reads as offline: an error with Retry, never a stuck skeleton', async () => {
    // e.g. a missing handler after a stale preload: useWorkLoad must settle it (settleWork)
    api.myTasks.mockRejectedValueOnce(new Error('ipc closed'))
    await mount({ ...WS, id: 'w-rejected' })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t reach UniWork')
    expect(host.querySelector('.wb-work-skeleton')).toBeNull()
    await click(buttonByText('Retry'))
    expect(host.textContent).toContain('Send the quote')
  })

  it('a status key missing from the catalogue shows as-is and stays open', async () => {
    api.myTasks.mockResolvedValueOnce({ ok: true, value: [{ ...TASK, status: 'qa_hold' }] })
    await mount({ ...WS, id: 'w-unknown' })
    expect(host.textContent).toContain('qa_hold')
    expect(checkbox().checked).toBe(false)
    await click(checkbox())
    expect(api.setTaskStatus).toHaveBeenCalledWith('t1', 'done')
  })

  it('signed out: the sign-in panel and no server call', async () => {
    await render(null, 'signed-out')
    expect(api.myTasks).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Sign in to see your work')
    expect(buttonByText('Sign in to UniWork')).toBeTruthy()
  })

  it('a workspace list that lost access says so, not "no workspace"', async () => {
    await render(null, 'forbidden')
    expect(host.textContent).toContain('You no longer have access to this workspace')
    expect(host.textContent).not.toContain('You are not in a workspace yet')
  })

  it('offline after a load: keeps the rows and says when they were loaded', async () => {
    await mount({ ...WS, id: 'w-stale' })
    api.myTasks.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await act(async () => {
      window.dispatchEvent(new Event(WB_REFRESH_EVENT))
    })
    await flush()
    expect(api.myTasks).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('Send the quote')
    expect(host.textContent).toContain('Updated at')
  })

  it('an empty list keeps quick add and shows the tasks empty state, tinted like the tab', async () => {
    api.myTasks.mockResolvedValue({ ok: true, value: [] })
    await mount({ ...WS, id: 'w-empty' })
    expect(host.querySelector('.wb-work-quick input')).not.toBeNull()
    const panel = host.querySelector('.wb-state')!
    // compact, inside the card, right under quick add
    expect(panel.classList.contains('is-compact')).toBe(true)
    expect(panel.previousElementSibling?.classList.contains('wb-work-quick')).toBe(true)
    expect(panel.parentElement?.classList.contains('wb-block')).toBe(true)
    expect(panel.querySelector('.wb-state-title')?.textContent).toBe('No open tasks')
    expect(panel.querySelector<HTMLElement>('.wb-state-icon')!.style.background).toBe(
      'var(--tint-green)',
    )
    expect(host.querySelector('.wb-work-state')).toBeNull()
  })
})

async function mountWithHead(
  workspace: UniworkWorkspaceRef | null,
  workspaceError: UniworkWorkError | null = null,
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(WorkTasksPane, {
          workspace,
          workspaceError,
          onReload,
          head: { title: 'Tasks', summary: 'Your UniWork tasks' },
        }),
      ),
    )
  })
  await flush()
}

describe('Tasks tab layout (redesign spec 4.2)', () => {
  it('quick add is the first row of the list block; rows are grouped, keyed in mono, no table', async () => {
    await mount({ ...WS, id: 'w-layout' })
    expect(host.querySelector('table')).toBeNull()
    // one card: quick add, the column header, then the groups
    expect(host.querySelectorAll('.wb-block')).toHaveLength(1)
    const block = host.querySelector('.wb-block')!
    expect(block.firstElementChild?.classList.contains('wb-work-quick')).toBe(true)
    expect(block.children[1]?.classList.contains('wb-work-cols')).toBe(true)
    expect(block.querySelector('.wb-work-quick-plus')).not.toBeNull()
    // no Add button: Enter adds
    expect(host.querySelector('.wb-work-quick button')).toBeNull()
    expect(host.querySelector('.wb-group-head')?.textContent).toBe('Today 1')
    expect(host.querySelector('.wb-work-row .wb-mono')?.textContent).toBe('OPS-7')
    // the status is a neutral pill with a dot
    const status = host.querySelector('.wb-work-row .wb-pill:not(.wb-num)')!
    expect(status.className).toBe('wb-pill')
    expect(status.textContent).toBe('To do')
    expect(status.querySelector('.wb-pill-dot')).not.toBeNull()
    expect(checkbox().classList.contains('uw-sr-only')).toBe(true)
    expect(checkbox().closest('label.wb-check')?.querySelector('.wb-check-box')).not.toBeNull()
  })

  it('the column header and every row share the six grid columns', async () => {
    await mount({ ...WS, id: 'w-cols' })
    const cols = host.querySelector('.wb-work-cols')!
    expect(cols.getAttribute('aria-hidden')).toBe('true')
    expect(Array.from(cols.children).map((c) => c.textContent)).toEqual([
      '',
      'Task',
      'ID',
      'Status',
      'Due',
      '',
    ])
    const row = host.querySelector('.wb-work-row')!
    expect(row.classList.contains('wb-row')).toBe(true)
    // checkbox | title | ID | status | due | open on web, in that order
    expect(Array.from(row.children).map((c) => c.className)).toEqual([
      'wb-check',
      'wb-row-title',
      'wb-mono',
      'wb-pill',
      'wb-pill wb-num is-warning',
      'wb-row-actions',
    ])
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    expect(css).toContain(
      '.wb-work-cols,\n.wb-work-row {\n  display: grid;\n  grid-template-columns: 16px minmax(0, 1fr) 64px 112px 108px 28px;',
    )
    const open = row.querySelector<HTMLButtonElement>('.wb-row-actions .wb-icon-btn')!
    expect(open.getAttribute('aria-label')).toBe('Open on the web: Send the quote')
    await click(open)
    expect(api.openWeb).toHaveBeenCalledWith({
      kind: 'task',
      orgSlug: 'acme',
      wsSlug: 'ops',
      id: 't1',
    })
  })

  it('Enter adds a task: no button, the form submits on its own and the field clears', async () => {
    api.createTask.mockResolvedValueOnce({
      ok: true,
      value: { ...TASK, id: 't9', title: 'Book a room' },
    })
    await mount({ ...WS, id: 'w-enter' })
    const form = host.querySelector<HTMLFormElement>('form.wb-work-quick')!
    expect(form.querySelector('button')).toBeNull()
    const input = form.querySelector('input')!
    await type(input, 'Book a room')
    // implicit submission: what Enter in the form's only field does
    await act(async () => form.requestSubmit())
    await flush()
    expect(api.createTask).toHaveBeenCalledWith({
      workspaceId: 'w-enter',
      title: 'Book a room',
      idempotencyKey: expect.any(String),
    })
    expect(input.value).toBe('')
    expect(input.disabled).toBe(false)
    expect(host.textContent).toContain('Book a room')
  })

  it('Enter on an empty name: the error sits at the field, no request', async () => {
    await mount({ ...WS, id: 'w-empty-name' })
    const form = host.querySelector<HTMLFormElement>('form.wb-work-quick')!
    const input = form.querySelector('input')!
    await act(async () => form.requestSubmit())
    expect(api.createTask).not.toHaveBeenCalled()
    const error = form.querySelector('.wb-work-quick-error')!
    expect(error.textContent).toBe('Type a task name first.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
    // no toast for a typing slip
    expect(host.querySelector('.wb-toast')).toBeNull()
    await type(input, 'B')
    expect(form.querySelector('.wb-work-quick-error')).toBeNull()
  })

  it('a just-done row stays, struck through, until the next load drops it', async () => {
    await mount({ ...WS, id: 'w-done' })
    await click(checkbox())
    await flush()
    const row = host.querySelector('.wb-work-row')!
    expect(row.classList.contains('is-done')).toBe(true)
    expect(row.querySelector('.wb-row-title')?.textContent).toBe('Send the quote')
    expect(row.querySelector('.wb-pill:not(.wb-num)')?.className).toBe('wb-pill is-success')
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    expect(css).toMatch(/\n\.wb-row\.is-done \.wb-row-title \{[^}]*text-decoration: line-through;/)
    // a refresh: the server no longer lists it as open
    api.myTasks.mockResolvedValueOnce({ ok: true, value: [{ ...TASK, status: 'done' }] })
    await act(async () => {
      window.dispatchEvent(new Event(WB_REFRESH_EVENT))
    })
    await flush()
    expect(host.querySelector('.wb-work-row')).toBeNull()
  })

  it('with a head: the toolbar summary counts open, overdue and due-today tasks once loaded', async () => {
    await mountWithHead({ ...WS, id: 'w-head' })
    expect(host.querySelectorAll('.wb-toolbar')).toHaveLength(1)
    // the tab name is a heading for screen readers only: the tab row shows it
    expect(host.querySelector('.wb-toolbar h2.uw-sr-only')?.textContent).toBe('Tasks')
    expect(host.querySelector('.wb-toolbar-text')?.textContent).toBe('Open: 1 · Due today: 1')
    expect(host.querySelector('.wb-toolbar-text strong')?.textContent).toBe('Open: 1')
    const web = host.querySelector<HTMLButtonElement>('.wb-toolbar-actions .wb-btn-ghost')!
    expect(web.textContent).toBe('Open on the web')
    await click(web)
    expect(api.openWeb).toHaveBeenCalledWith({ kind: 'my-tasks', orgSlug: 'acme', wsSlug: 'ops' })
  })

  it('with a head: the hint while loading, the toolbar stays above the skeleton', async () => {
    api.myTasks.mockImplementationOnce(
      () => new Promise<UniworkWorkResult<WorkTask[]>>(() => undefined),
    )
    await mountWithHead({ ...WS, id: 'w-head-pending' })
    expect(host.querySelectorAll('.wb-toolbar')).toHaveLength(1)
    expect(host.querySelector('.wb-toolbar-text')?.textContent).toBe('Your UniWork tasks')
    expect(host.querySelector('.wb-work-skeleton')).not.toBeNull()
  })

  it('with a head: signed out still shows the toolbar above the sign-in panel', async () => {
    await mountWithHead(null, 'signed-out')
    expect(host.querySelector('.wb-toolbar + *')?.textContent).toContain('Sign in to see your work')
  })
})
