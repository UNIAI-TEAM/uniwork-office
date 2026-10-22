/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, UniworkLaunchEvent, UniworkWorkspaceRef } from '../src/shared/home-api'
import type { UniworkWorkApi, WorkNotification } from '../src/shared/uniwork-work-api'
import { InboxPane } from '../src/renderer/src/InboxPane'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  NOTICES_CHANGED_EVENT,
  NOTICES_REFRESH_MS,
  useInboxUnread,
} from '../src/renderer/src/notices-data'
import {
  onDocumentsIntent,
  resetDocumentsIntentBusForTests,
  type DocumentsIntent,
} from '../src/renderer/src/documents-intent-bus'
import { onUniworkNotice } from '../src/renderer/src/uniwork-notice-bus'
import { WbToastHost, createWbToasts, type WbToasts } from '../src/renderer/src/WbToastHost'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS = {
  id: 'w',
  name: 'Team',
  orgId: 'o1',
  slug: 'team',
  orgSlug: 'acme',
} as UniworkWorkspaceRef
const NOW = '2026-10-22T05:00:00Z'

let host: HTMLDivElement
let root: Root
let toasts: WbToasts
let work: Record<string, ReturnType<typeof vi.fn>>
let api: Record<string, ReturnType<typeof vi.fn>>
let launch: UniworkLaunchEvent[]
let offLaunch: () => void
let visibility: 'visible' | 'hidden'

const ok = <T>(value: T) => ({ ok: true as const, value })
const page = (notifications: WorkNotification[], next_before: string | null = null) =>
  ok({ notifications, next_before })

const row = (id: string, over: Partial<WorkNotification> = {}): WorkNotification => ({
  id,
  kind: 'document_commented',
  workspace_id: 'w',
  resource_type: 'document',
  resource_id: `d-${id}`,
  actor_kind: 'user',
  title_key: 'x',
  params: { actor: 'Minh', document: `Doc ${id}` },
  created_at: '2026-10-22T04:00:00Z',
  ...over,
})
const seen = (id: string, over: Partial<WorkNotification> = {}) =>
  row(id, { read_at: '2026-10-22T04:30:00Z', ...over })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  toasts = createWbToasts()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
  work = {
    listNotifications: vi.fn(async () => page([])),
    unreadCount: vi.fn(async () => ok({ total: 0, by_workspace: {} })),
    markNotificationsRead: vi.fn(async () => ok(null)),
    markNotificationsUnread: vi.fn(async () => ok(null)),
    archiveNotifications: vi.fn(async () => ok(null)),
    unarchiveNotifications: vi.fn(async () => ok(null)),
    markAllNotificationsRead: vi.fn(async () => ok([])),
    notificationDocuments: vi.fn(async () => ok({ documents: [], next_cursor: null })),
    openWeb: vi.fn(async () => true),
  }
  window.uniworkWork = work as unknown as UniworkWorkApi
  api = {
    uniworkOpenDocument: vi.fn(async () => ok({ path: '/c/x.docx' })),
    uniworkOpenDocumentAt: vi.fn(async () => ok({ path: '/c/x.docx' })),
    accountLogin: vi.fn(async () => true),
  }
  window.aiOffice = api as unknown as HomeApi
  launch = []
  offLaunch = onUniworkNotice((e) => launch.push(e))
  resetDocumentsIntentBusForTests()
})
afterEach(() => {
  offLaunch()
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  delete (document as { visibilityState?: unknown }).visibilityState
  resetDocumentsIntentBusForTests()
})

const flush = async () =>
  act(async () => {
    for (let i = 0; i < 14; i++) await Promise.resolve()
  })

async function mount(
  over: Partial<Parameters<typeof InboxPane>[0]> = {},
  lang: 'en' | 'vi' = 'en',
  fresh = true,
) {
  if (fresh && host.childNodes.length > 0) {
    // a new pane, not a re-render of the one on screen
    act(() => root.unmount())
    root = createRoot(host)
  }
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(
          WbToastHost,
          { toasts },
          createElement(InboxPane, {
            workspace: WS,
            workspaceError: null,
            onReload: vi.fn(),
            head: { title: 'Inbox', summary: 'hint' },
            ...over,
          }),
        ),
      ),
    )
  })
  await flush()
}

/** a server that keeps its rows: reads, archives and mark all change what the next list says */
function serve(initial: WorkNotification[], next: string | null = null): WorkNotification[] {
  const rows = initial.map((n) => ({ ...n }))
  const archived = new Map<string, { at: number; row: WorkNotification }>()
  const pick = (ids: string[]) => rows.filter((r) => ids.includes(r.id))
  work.listNotifications.mockImplementation(async (q?: { unread?: boolean }) =>
    page(
      rows.filter((r) => !q?.unread || !r.read_at).map((r) => ({ ...r })),
      next,
    ),
  )
  work.markNotificationsRead.mockImplementation(async (ids: string[]) => {
    for (const r of pick(ids)) r.read_at ??= NOW
    return ok(null)
  })
  work.markNotificationsUnread.mockImplementation(async (ids: string[]) => {
    for (const r of pick(ids)) delete r.read_at
    return ok(null)
  })
  work.archiveNotifications.mockImplementation(async (ids: string[]) => {
    for (const id of ids) {
      const at = rows.findIndex((r) => r.id === id)
      if (at >= 0) archived.set(id, { at, row: rows.splice(at, 1)[0]! })
    }
    return ok(null)
  })
  work.unarchiveNotifications.mockImplementation(async (ids: string[]) => {
    for (const id of ids) {
      const hit = archived.get(id)
      if (hit) rows.splice(Math.min(hit.at, rows.length), 0, hit.row)
      archived.delete(id)
    }
    return ok(null)
  })
  work.markAllNotificationsRead.mockImplementation(async () => {
    const ids = rows.filter((r) => !r.read_at).map((r) => r.id)
    for (const r of rows) r.read_at ??= NOW
    return ok(ids)
  })
  return rows
}
const show = async (rows: WorkNotification[], next: string | null = null) => {
  serve(rows, next)
  await mount()
}

const items = () => Array.from(host.querySelectorAll<HTMLElement>('li[data-notice-id]'))
const itemOf = (id: string) => items().find((li) => li.dataset.noticeId === id)!
const mainOf = (id: string) => itemOf(id).querySelector<HTMLButtonElement>('.wb-inbox-main')!
const ids = () => items().map((li) => li.dataset.noticeId)
const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label)
const labelled = (scope: ParentNode, label: string) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.getAttribute('aria-label') === label,
  )
const groupHeads = () =>
  Array.from(host.querySelectorAll('.wb-inbox-group-head strong')).map((h) => h.textContent)
const chips = () => host.querySelector('.wb-inbox-chips')!
const chip = (label: string) =>
  Array.from(chips().querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent?.startsWith(label),
  )
const toastText = () =>
  Array.from(host.querySelectorAll('.wb-toast-text'))
    .map((t) => t.textContent)
    .join(' | ')
const click = async (el: HTMLElement | undefined | null) => {
  expect(el).toBeTruthy()
  await act(async () => el!.click())
  await flush()
}
const press = async (el: Element, key: string, init: KeyboardEventInit = {}) => {
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
  })
  await flush()
}
const calls = () => work.listNotifications.mock.calls.length
const intents = () => {
  const taken: DocumentsIntent[] = []
  const off = onDocumentsIntent((intent) => {
    taken.push(intent)
    return true
  })
  return { taken, off }
}

describe('InboxPane list (UNI-2079)', () => {
  it('lists this workspace, 30 at a time, newest first, with the sentence, the pill and the time', async () => {
    await show([
      row('n1'),
      seen('n2', {
        kind: 'document_shared',
        params: { actor: 'Lan', document: 'Plan', level: 'edit' },
      }),
    ])
    expect(work.listNotifications).toHaveBeenCalledWith({ workspaceId: 'w', limit: 30 })
    expect(ids()).toEqual(['n1', 'n2'])
    expect(itemOf('n1').textContent).toContain('Minh commented on “Doc n1”')
    expect(itemOf('n1').querySelector('.wb-pill')!.textContent).toBe('Comment')
    // the share level is worded, never the raw "edit"
    expect(itemOf('n2').textContent).toContain('Lan shared “Plan” with you')
    expect(itemOf('n2').textContent).not.toContain('(edit)')
    const time = itemOf('n1').querySelector('time')!
    expect(time.getAttribute('datetime')).toBe('2026-10-22T04:00:00Z')
    expect(time.textContent).toBe('1 hour ago')
  })

  it('sends only the keys it has: no before, no unread, on the first page', async () => {
    await show([row('n1')])
    expect(Object.keys(work.listNotifications.mock.calls[0]![0] as object).sort()).toEqual([
      'limit',
      'workspaceId',
    ])
  })

  it('marks an unread row with a dot a screen reader can name, and a read row without', async () => {
    await show([row('n1'), seen('n2')])
    expect(itemOf('n1').querySelector('.wb-inbox-dot')).not.toBeNull()
    expect(itemOf('n1').classList.contains('is-unread')).toBe(true)
    expect(itemOf('n1').querySelector('.uw-sr-only')!.textContent).toBe('Unread')
    expect(itemOf('n2').querySelector('.wb-inbox-dot')).toBeNull()
    expect(itemOf('n2').classList.contains('is-unread')).toBe(false)
  })

  it('shows no pill for a task or meeting row and says it opens in the browser', async () => {
    await show([
      row('t1', {
        kind: 'task_assigned',
        resource_type: 'task',
        resource_id: 't9',
        params: { actor: 'Lan', task: 'Send the contract' },
      }),
    ])
    expect(itemOf('t1').textContent).toContain('Lan assigned you “Send the contract”')
    expect(itemOf('t1').querySelector('.wb-pill')).toBeNull()
    const mark = itemOf('t1').querySelector('.wb-inbox-web')!
    expect(mark.getAttribute('title')).toBe('Opens in your browser')
    expect(mark.querySelector('.uw-sr-only')!.textContent).toBe('Opens in your browser')
    // a document row has no such mark
    await show([row('n1')])
    expect(itemOf('n1').querySelector('.wb-inbox-web')).toBeNull()
  })

  it('groups unread first, then Today, Yesterday, the last 7 days and older, empty groups dropped', async () => {
    await show([
      row('u1'),
      seen('a1', { created_at: '2026-10-22T03:00:00Z' }),
      seen('b1', { created_at: '2026-10-21T10:00:00Z' }),
      seen('c1', { created_at: '2026-10-18T10:00:00Z' }),
      seen('d1', { created_at: '2026-09-01T10:00:00Z' }),
    ])
    expect(groupHeads()).toEqual(['Unread', 'Today', 'Yesterday', 'Last 7 days', 'Older'])
    const counts = Array.from(host.querySelectorAll('.wb-inbox-group-count')).map(
      (c) => c.textContent,
    )
    expect(counts).toEqual(Array(5).fill('1 notification'))
    await show([seen('a1')])
    expect(groupHeads()).toEqual(['Today'])
  })

  it('words the pane in Vietnamese', async () => {
    work.listNotifications.mockResolvedValue(page([row('n1')]))
    await mount({}, 'vi')
    expect(groupHeads()).toEqual(['Chưa đọc'])
    expect(host.textContent).toContain('Chưa đọc')
    expect(host.textContent).toContain('Minh')
    expect(labelled(itemOf('n1'), 'Đánh dấu đã đọc')).toBeTruthy()
    expect(labelled(itemOf('n1'), 'Lưu trữ')).toBeTruthy()
  })

  it('loads older rows by next_before and drops the button at the end', async () => {
    work.listNotifications
      .mockResolvedValueOnce(page([row('n1'), row('n2')], 'cursor-2'))
      .mockResolvedValueOnce(page([row('n3')], null))
    await mount()
    expect(button('Show older notifications')).toBeTruthy()
    await click(button('Show older notifications'))
    expect(work.listNotifications).toHaveBeenLastCalledWith({
      workspaceId: 'w',
      before: 'cursor-2',
      limit: 30,
    })
    expect(ids()).toEqual(['n1', 'n2', 'n3'])
    expect(button('Show older notifications')).toBeUndefined()
    expect(host.textContent).toContain('You have reached the end')
  })

  it('keeps the older rows loaded when the first page refreshes', async () => {
    work.listNotifications
      .mockResolvedValueOnce(page([row('n1', { created_at: '2026-10-22T04:00:00Z' })], 'c1'))
      .mockResolvedValueOnce(page([row('n2', { created_at: '2026-10-22T03:00:00Z' })], null))
      // the refresh: n1 is still the newest, a brand-new n0 sits on top
      .mockResolvedValueOnce(
        page(
          [
            row('n0', { created_at: '2026-10-22T04:30:00Z' }),
            row('n1', { created_at: '2026-10-22T04:00:00Z' }),
          ],
          'c1b',
        ),
      )
    await mount()
    await click(button('Show older notifications'))
    expect(ids()).toEqual(['n1', 'n2'])
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(ids()).toEqual(['n0', 'n1', 'n2'])
  })

  it('does not list a row twice when a page overlaps the rows already on screen', async () => {
    work.listNotifications
      .mockResolvedValueOnce(page([row('n1'), row('n2')], 'c'))
      .mockResolvedValueOnce(page([row('n2'), row('n3')], null))
    await mount()
    await click(button('Show older notifications'))
    expect(ids()).toEqual(['n1', 'n2', 'n3'])
  })
})

describe('InboxPane filters', () => {
  it('asks the server for unread only when Unread is on, and back to all', async () => {
    await show([row('n1'), seen('n2')])
    expect(button('All')!.getAttribute('aria-pressed')).toBe('true')
    work.listNotifications.mockResolvedValue(page([row('n1')]))
    await click(button('Unread'))
    expect(work.listNotifications).toHaveBeenLastCalledWith({
      workspaceId: 'w',
      unread: true,
      limit: 30,
    })
    expect(button('Unread')!.getAttribute('aria-pressed')).toBe('true')
    expect(ids()).toEqual(['n1'])
    await click(button('All'))
    expect(work.listNotifications).toHaveBeenLastCalledWith({ workspaceId: 'w', limit: 30 })
  })

  it('drops a pending Load older when the filter switches, the new filter asks for its first page only', async () => {
    let releaseOlder!: (v: ReturnType<typeof page>) => void
    work.listNotifications
      .mockResolvedValueOnce(page([row('n1')], 'c1'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseOlder = resolve
        }),
      )
      // the Unread first page still has an older page behind it
      .mockResolvedValueOnce(page([row('n1')], 'c2'))
    await mount()
    await click(button('Show older notifications'))
    await click(button('Unread'))
    await act(async () => releaseOlder(page([row('n0')], null)))
    await flush()
    const asked = work.listNotifications.mock.calls.map((c) => c[0] as { before?: string })
    expect(asked.filter((q) => q.before !== undefined)).toHaveLength(1)
    expect(asked).toHaveLength(3)
    expect(ids()).toEqual(['n1'])
  })

  it('keeps the filters on screen, over a skeleton, while the other filter loads', async () => {
    await show([row('n1'), seen('n2')])
    let release!: (v: ReturnType<typeof page>) => void
    work.listNotifications.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const unread = button('Unread')!
    unread.focus()
    await click(unread)
    expect(host.querySelector('.wb-work-skeleton')).not.toBeNull()
    // the same button, still focused: the bar was not rebuilt
    expect(button('Unread')).toBe(unread)
    expect(document.activeElement).toBe(unread)
    expect(unread.getAttribute('aria-pressed')).toBe('true')
    await act(async () => release(page([row('n1')])))
    await flush()
    expect(host.querySelector('.wb-work-skeleton')).toBeNull()
    expect(ids()).toEqual(['n1'])
  })

  it('counts the unread rows of each category on its chip and filters the list by it', async () => {
    await show([
      row('m1'),
      row('m2', { kind: 'document_mentioned' }),
      seen('m3'),
      row('a1', { kind: 'task_assigned', resource_type: 'task', params: { task: 'T' } }),
      row('w1', { kind: 'member_added', resource_type: 'workspace' }),
    ])
    expect(chips().getAttribute('role')).toBe('group')
    expect(chips().getAttribute('aria-label')).toBe('Notification type')
    const count = (label: string) => chip(label)!.querySelector('.wb-num')?.textContent ?? null
    expect(count('Mentions & comments')).toBe('2')
    expect(count('Assigned')).toBe('1')
    expect(count('Workspace')).toBe('1')
    expect(count('Meetings')).toBeNull()
    expect(chip('All types')!.getAttribute('aria-pressed')).toBe('true')
    // a screen reader hears the count as words
    expect(chip('Mentions & comments')!.querySelector('.uw-sr-only')!.textContent).toBe('2 unread')

    await click(chip('Mentions & comments'))
    expect(chip('Mentions & comments')!.getAttribute('aria-pressed')).toBe('true')
    expect(ids()).toEqual(['m1', 'm2', 'm3'])
    // the category is a view of the loaded rows: no new request
    expect(calls()).toBe(1)
    await click(chip('All types'))
    expect(ids()).toHaveLength(5)
  })

  it('says a category is empty and offers all types; with older pages it offers to keep looking', async () => {
    await show([row('m1')])
    await click(chip('Meetings'))
    expect(ids()).toEqual([])
    expect(host.textContent).toContain('Nothing of this type')
    await click(button('Show all types'))
    expect(ids()).toEqual(['m1'])

    await show([row('m1')], 'more')
    await click(chip('Meetings'))
    expect(host.textContent).toContain('None among the newest notifications')
    work.listNotifications.mockResolvedValueOnce(
      page([row('x1', { kind: 'meeting_invited', resource_type: 'meeting' })], null),
    )
    await click(button('Show older notifications'))
    expect(ids()).toEqual(['x1'])
  })

  it('says there is nothing, nothing unread, and starts over when the filter changes', async () => {
    await show([])
    expect(host.textContent).toContain('No notifications yet')
    expect(host.querySelector('.wb-inbox-list')).toBeNull()
    await click(button('Unread'))
    expect(host.textContent).toContain('Nothing unread')
  })
})

describe('InboxPane triage', () => {
  it('marks a row read, keeps it where it is, and reads it again on request', async () => {
    await show([row('n1'), row('n2')])
    await click(labelled(itemOf('n1'), 'Mark as read'))
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
    expect(itemOf('n1').querySelector('.wb-inbox-dot')).toBeNull()
    // it does not jump to another group under the pointer
    expect(groupHeads()).toEqual(['Unread'])
    expect(ids()).toEqual(['n1', 'n2'])
    await click(labelled(itemOf('n1'), 'Mark as unread'))
    expect(work.markNotificationsUnread).toHaveBeenCalledWith(['n1'])
    expect(itemOf('n1').querySelector('.wb-inbox-dot')).not.toBeNull()
  })

  it('puts the row back and says so when marking read is refused', async () => {
    work.markNotificationsRead.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await show([row('n1')])
    await click(labelled(itemOf('n1'), 'Mark as read'))
    expect(itemOf('n1').querySelector('.wb-inbox-dot')).not.toBeNull()
    expect(toastText()).toContain('Something went wrong, try again')
  })

  it('archives a row with an Undo toast; Undo brings it back', async () => {
    await show([row('n1'), row('n2')])
    await click(labelled(itemOf('n1'), 'Archive'))
    expect(work.archiveNotifications).toHaveBeenCalledWith(['n1'])
    expect(ids()).toEqual(['n2'])
    expect(toastText()).toContain('Archived 1 notification')
    await click(button('Undo'))
    expect(work.unarchiveNotifications).toHaveBeenCalledWith(['n1'])
    expect(ids()).toEqual(['n1', 'n2'])
  })

  it('says the undo failed when the server refuses it', async () => {
    work.unarchiveNotifications.mockResolvedValueOnce({ ok: false, error: 'server' })
    await show([row('n1')])
    await click(labelled(itemOf('n1'), 'Archive'))
    await click(button('Undo'))
    expect(toastText()).toContain('Could not undo, try again')
  })

  it('puts an archived row back when the archive is refused', async () => {
    work.archiveNotifications.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await show([row('n1')])
    await click(labelled(itemOf('n1'), 'Archive'))
    expect(ids()).toEqual(['n1'])
    expect(toastText()).toContain('Something went wrong, try again')
    expect(host.querySelector('.wb-toast button.wb-link')).toBeNull()
  })

  it('marks the whole workspace read with an Undo through the returned ids', async () => {
    await show([row('n1'), row('n2'), seen('n3')])
    await click(button('Mark all as read'))
    expect(work.markAllNotificationsRead).toHaveBeenCalledWith({ workspaceId: 'w' })
    expect(itemOf('n1').querySelector('.wb-inbox-dot')).toBeNull()
    expect(toastText()).toContain('Marked 2 notifications as read')
    await click(button('Undo'))
    expect(work.markNotificationsUnread).toHaveBeenCalledTimes(1)
    expect(work.markNotificationsUnread).toHaveBeenCalledWith(['n1', 'n2'])
  })

  it('undoes a mark-all of 250 ids in calls of at most 100, each id once, and reports a call that failed', async () => {
    const all = Array.from({ length: 250 }, (_, i) => `n${i}`)
    // the server may repeat an id: it is sent once
    work.markAllNotificationsRead.mockResolvedValueOnce(ok([...all, 'n0', 'n7']))
    work.markNotificationsUnread
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce({ ok: false, error: 'server' })
      .mockResolvedValue(ok(null))
    await show([row('n0')])
    await click(button('Mark all as read'))
    await click(button('Undo'))
    const sent = work.markNotificationsUnread.mock.calls.map((c) => c[0] as string[])
    expect(sent.map((c) => c.length)).toEqual([100, 100, 50])
    expect(sent.flat()).toEqual(all)
    expect(toastText()).toContain('Could not undo, try again')
  })

  it('has nothing to mark and no toast when no row is unread and nothing older exists', async () => {
    await show([seen('n1')])
    expect(button('Mark all as read')!.hasAttribute('disabled')).toBe(true)
    await show([seen('n1')], 'more')
    expect(button('Mark all as read')!.hasAttribute('disabled')).toBe(false)
    work.markAllNotificationsRead.mockResolvedValueOnce(ok([]))
    await click(button('Mark all as read'))
    expect(toastText()).toBe('')
  })

  it('tells the rest of the app after every action', async () => {
    const changed = vi.fn()
    window.addEventListener(NOTICES_CHANGED_EVENT, changed)
    try {
      await show([row('n1'), row('n2'), row('n3')])
      await click(labelled(itemOf('n1'), 'Mark as read'))
      expect(changed).toHaveBeenCalledTimes(1)
      await click(labelled(itemOf('n2'), 'Archive'))
      expect(changed).toHaveBeenCalledTimes(2)
      await click(button('Mark all as read'))
      expect(changed).toHaveBeenCalledTimes(3)
    } finally {
      window.removeEventListener(NOTICES_CHANGED_EVENT, changed)
    }
  })

  it('reloads the list after an action', async () => {
    await show([row('n1')])
    const before = calls()
    await click(labelled(itemOf('n1'), 'Mark as read'))
    expect(calls()).toBe(before + 1)
  })
})

describe('InboxPane keyboard', () => {
  it('j and k, ArrowDown and ArrowUp move the focus between rows', async () => {
    await show([row('n1'), row('n2'), row('n3')])
    mainOf('n1').focus()
    await press(mainOf('n1'), 'j')
    expect(document.activeElement).toBe(mainOf('n2'))
    await press(mainOf('n2'), 'ArrowDown')
    expect(document.activeElement).toBe(mainOf('n3'))
    // the end of the list is a wall
    await press(mainOf('n3'), 'j')
    expect(document.activeElement).toBe(mainOf('n3'))
    await press(mainOf('n3'), 'k')
    expect(document.activeElement).toBe(mainOf('n2'))
    await press(mainOf('n2'), 'ArrowUp')
    expect(document.activeElement).toBe(mainOf('n1'))
    await press(mainOf('n1'), 'k')
    expect(document.activeElement).toBe(mainOf('n1'))
  })

  it('j from the toolbar lands on the first row', async () => {
    await show([row('n1'), row('n2')])
    const all = button('All')!
    all.focus()
    await press(all, 'j')
    expect(document.activeElement).toBe(mainOf('n1'))
  })

  it('r toggles read and e archives the focused row, and the focus moves on to the next row', async () => {
    await show([row('n1'), row('n2'), row('n3')])
    mainOf('n2').focus()
    await press(mainOf('n2'), 'r')
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n2'])
    await press(mainOf('n2'), 'r')
    expect(work.markNotificationsUnread).toHaveBeenCalledWith(['n2'])
    await press(mainOf('n2'), 'e')
    expect(work.archiveNotifications).toHaveBeenCalledWith(['n2'])
    expect(ids()).toEqual(['n1', 'n3'])
    expect(document.activeElement).toBe(mainOf('n3'))
    // the last row archived: the focus goes to the one before it
    await press(mainOf('n3'), 'e')
    expect(document.activeElement).toBe(mainOf('n1'))
  })

  it('keeps its hands off a key with a modifier and a key typed in a text field', async () => {
    await show([row('n1')])
    mainOf('n1').focus()
    await press(mainOf('n1'), 'r', { ctrlKey: true })
    await press(mainOf('n1'), 'e', { metaKey: true })
    expect(work.markNotificationsRead).not.toHaveBeenCalled()
    expect(work.archiveNotifications).not.toHaveBeenCalled()
    const input = document.createElement('input')
    mainOf('n1').parentElement!.append(input)
    input.focus()
    await press(input, 'e')
    expect(work.archiveNotifications).not.toHaveBeenCalled()
    input.remove()
  })

  it('shows the keys and a focus ring on the row buttons', async () => {
    await show([row('n1')])
    const hint = host.querySelector('.wb-inbox-keys')!
    expect(hint.textContent).toContain('move')
    expect(hint.textContent).toContain('open')
    expect(hint.textContent).toContain('read / unread')
    expect(hint.textContent).toContain('archive')
    expect(mainOf('n1').tagName).toBe('BUTTON')
  })
})

describe('InboxPane opens a notice', () => {
  it('opens a document at the comment thread and marks the row read', async () => {
    await show([row('n1', { params: { actor: 'Minh', document: 'Plan', comment_id: 'c1' } })])
    await click(mainOf('n1'))
    expect(api.uniworkOpenDocumentAt).toHaveBeenCalledWith({ documentId: 'd-n1', commentId: 'c1' })
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
  })

  it('sends the comment id only when the notice has one', async () => {
    await show([
      row('n1', { params: { actor: 'Minh', document: 'Plan', comment_id: 'c1' } }),
      row('n2', { params: { actor: 'Minh', document: 'Plan', comment_id: '' } }),
    ])
    await click(mainOf('n1'))
    expect(Object.keys(api.uniworkOpenDocumentAt.mock.calls[0]![0] as object).sort()).toEqual([
      'commentId',
      'documentId',
    ])
    // an empty comment id is none: the plain open call, no comment key anywhere
    await click(mainOf('n2'))
    expect(api.uniworkOpenDocumentAt).toHaveBeenCalledTimes(1)
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d-n2')
  })

  it('opens a document with no comment plainly', async () => {
    await show([row('n1', { kind: 'document_shared', params: { actor: 'Lan', document: 'Plan' } })])
    await click(mainOf('n1'))
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d-n1')
    expect(api.uniworkOpenDocumentAt).not.toHaveBeenCalled()
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
  })

  it('keeps the row unread when the document fails to open', async () => {
    api.uniworkOpenDocument.mockResolvedValueOnce({ ok: false, error: 'not_found' })
    await show([row('n1')])
    await click(mainOf('n1'))
    expect(work.markNotificationsRead).not.toHaveBeenCalled()
    expect(itemOf('n1').querySelector('.wb-inbox-dot')).not.toBeNull()
  })

  it('sends an access request to the Share section and a trash notice to the Trash row', async () => {
    const { taken, off } = intents()
    try {
      await show([
        row('s1', { kind: 'document_access_requested' }),
        row('s2', { kind: 'document_break_glass' }),
        row('s3', { kind: 'document_trashed_by_other' }),
      ])
      await click(mainOf('s1'))
      await click(mainOf('s2'))
      await click(mainOf('s3'))
      expect(taken).toEqual([
        { kind: 'share', documentId: 'd-s1', workspaceId: 'w', section: 'requests' },
        { kind: 'share', documentId: 'd-s2', workspaceId: 'w', section: 'break_glass' },
        { kind: 'trash', documentId: 'd-s3', workspaceId: 'w' },
      ])
      expect(work.markNotificationsRead).toHaveBeenCalledWith(['s1'])
      expect(work.markNotificationsRead).toHaveBeenCalledWith(['s3'])
      // the pane switches no surface itself
      expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    } finally {
      off()
    }
  })

  it.each([
    [
      'a task',
      { kind: 'task_assigned', resource_type: 'task', resource_id: 't9', params: { task: 'T' } },
      { kind: 'task', orgSlug: 'acme', wsSlug: 'team', id: 't9' },
    ],
    [
      'a meeting',
      { kind: 'meeting_invited', resource_type: 'meeting', resource_id: 'm1', params: {} },
      { kind: 'meeting', orgSlug: 'acme', wsSlug: 'team', id: 'm1' },
    ],
    [
      'a chat message, in its room',
      {
        kind: 'chat_dm',
        resource_type: 'chat_message',
        resource_id: 'cm1',
        resource_parent_id: 'room-7',
        params: {},
      },
      { kind: 'room', orgSlug: 'acme', wsSlug: 'team', id: 'room-7' },
    ],
    [
      'a notice with no page of its own',
      { kind: 'member_added', resource_type: 'workspace', resource_id: 'w', params: {} },
      { kind: 'inbox', orgSlug: 'acme', wsSlug: 'team' },
    ],
  ] as const)('opens %s on the web with the workspace slugs', async (_name, over, target) => {
    await show([row('n1', over as Partial<WorkNotification>)])
    await click(mainOf('n1'))
    expect(work.openWeb).toHaveBeenCalledWith(target)
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
  })

  it('keeps a web row unread when the browser did not open', async () => {
    work.openWeb.mockResolvedValueOnce(false)
    await show([row('n1', { kind: 'task_assigned', resource_type: 'task', params: { task: 'T' } })])
    await click(mainOf('n1'))
    expect(work.markNotificationsRead).not.toHaveBeenCalled()
  })

  it('only marks read a declined access request: nothing to open, nothing to say', async () => {
    await show([row('n1', { kind: 'document_access_declined' })])
    await click(mainOf('n1'))
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(launch).toEqual([])
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
  })

  it('says why a deleted or out-of-reach document does not open, dims the row, and marks it read', async () => {
    await show([row('d1', { resource_deleted: true }), row('d2', { resource_access_lost: true })])
    expect(itemOf('d1').classList.contains('is-gone')).toBe(true)
    expect(itemOf('d1').textContent).toContain('This document was deleted in UniWork.')
    expect(itemOf('d2').textContent).toContain('You don’t have access to this document.')
    await click(mainOf('d1'))
    await click(mainOf('d2'))
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(launch).toEqual([
      { phase: 'failed', error: 'deleted' },
      { phase: 'failed', error: 'forbidden' },
    ])
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['d1'])
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['d2'])
  })

  it('opens a one-document change and the list of a several-document change', async () => {
    await show([
      row('c1', {
        kind: 'document_changed',
        params: { actor: 'Lan', verb: 'renamed' },
        count: 1,
        sample_documents: [{ id: 'd1', title: 'Plan' }],
      }),
      row('c2', {
        kind: 'document_changed',
        params: { actor: 'Lan', verb: 'renamed' },
        count: 5,
        sample_documents: [
          { id: 'a', title: 'Plan' },
          { id: 'b', title: 'Budget' },
        ],
      }),
    ])
    expect(itemOf('c1').textContent).toContain('Lan renamed “Plan”')
    expect(itemOf('c2').textContent).toContain('Lan renamed 5 documents')
    await click(mainOf('c1'))
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d-c1')
    await click(mainOf('c2'))
    expect(work.notificationDocuments).toHaveBeenCalledWith('c2', { limit: 50 })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    // the dialog marks the notice read itself once its first page loaded
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['c2'])
  })

  it('keeps the other rows in place while one is opened', async () => {
    await show([row('n1'), row('n2')])
    await click(mainOf('n1'))
    expect(ids()).toEqual(['n1', 'n2'])
  })
})

describe('InboxPane states', () => {
  it('shows a skeleton while the first page loads', async () => {
    let release!: (v: ReturnType<typeof page>) => void
    work.listNotifications.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await mount()
    const skeleton = host.querySelector('.wb-work-skeleton')!
    expect(skeleton.getAttribute('aria-busy')).toBe('true')
    expect(host.querySelector('.wb-inbox-list')).toBeNull()
    await act(async () => release(page([row('n1')])))
    await flush()
    expect(host.querySelector('.wb-work-skeleton')).toBeNull()
    expect(ids()).toEqual(['n1'])
  })

  it('asks to sign in and loads nothing when signed out', async () => {
    await mount({ workspace: null, workspaceError: 'signed-out' })
    expect(work.listNotifications).not.toHaveBeenCalled()
    expect(host.querySelector('.wb-state')).not.toBeNull()
    await click(button('Sign in to UniWork'))
    expect(api.accountLogin).toHaveBeenCalled()
  })

  it('says it is offline, with Try again, when the first load fails', async () => {
    work.listNotifications.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await mount()
    expect(host.querySelector('.wb-state[role="alert"]')).not.toBeNull()
    work.listNotifications.mockResolvedValueOnce(page([row('n1')]))
    await click(button('Retry'))
    expect(ids()).toEqual(['n1'])
    expect(host.querySelector('.wb-state')).toBeNull()
  })

  it('treats a thrown call as offline', async () => {
    work.listNotifications.mockRejectedValueOnce(new Error('ipc'))
    await mount()
    expect(host.querySelector('.wb-state[role="alert"]')).not.toBeNull()
  })

  it('keeps the rows and says the refresh failed, with Retry', async () => {
    await show([row('n1')])
    work.listNotifications.mockResolvedValueOnce({ ok: false, error: 'server' })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(ids()).toEqual(['n1'])
    const partial = host.querySelector('.wb-ov-partial')!
    expect(partial.textContent).toContain('Something went wrong, try again')
    work.listNotifications.mockResolvedValueOnce(page([row('n1'), row('n2')]))
    await click(partial.querySelector('button'))
    expect(ids()).toEqual(['n1', 'n2'])
    expect(host.querySelector('.wb-ov-partial')).toBeNull()
  })

  it('keeps the rows and says so when a later page fails; the button tries again', async () => {
    work.listNotifications
      .mockResolvedValueOnce(page([row('n1')], 'c'))
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce(page([row('n2')], null))
    await mount()
    await click(button('Show older notifications'))
    expect(ids()).toEqual(['n1'])
    expect(host.querySelector('.wb-ov-partial')!.textContent).toContain('Something went wrong')
    await click(button('Show older notifications'))
    expect(ids()).toEqual(['n1', 'n2'])
    expect(host.querySelector('.wb-ov-partial')).toBeNull()
  })

  it('reloads for another workspace and ignores the answer of the one it left', async () => {
    let releaseA!: (v: ReturnType<typeof page>) => void
    work.listNotifications.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseA = resolve
      }),
    )
    await mount()
    work.listNotifications.mockResolvedValueOnce(page([row('b1', { workspace_id: 'w2' })]))
    await mount({ workspace: { ...WS, id: 'w2' } as UniworkWorkspaceRef }, 'en', false)
    expect(work.listNotifications).toHaveBeenLastCalledWith({ workspaceId: 'w2', limit: 30 })
    await act(async () => releaseA(page([row('a1')])))
    await flush()
    expect(ids()).toEqual(['b1'])
  })
})

describe('InboxPane freshness', () => {
  it('loads on mount, on window focus and when the window becomes visible', async () => {
    await show([row('n1')])
    expect(calls()).toBe(1)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(calls()).toBe(2)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()
    expect(calls()).toBe(3)
    // hidden: nothing to refresh
    visibility = 'hidden'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()
    expect(calls()).toBe(3)
  })

  it('reloads every 60 seconds while the window is visible, and not while it is hidden', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    work.listNotifications.mockResolvedValue(page([row('n1')]))
    await mount()
    expect(NOTICES_REFRESH_MS).toBe(60_000)
    expect(calls()).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000)
    })
    expect(calls()).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(calls()).toBe(2)
    visibility = 'hidden'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(calls()).toBe(2)
    visibility = 'visible'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(calls()).toBe(3)
  })

  it('stops listening and polling once it unmounts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    await show([row('n1')])
    act(() => root.unmount())
    const before = calls()
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(180_000)
    expect(calls()).toBe(before)
    root = createRoot(host)
  })

  it('never has two list requests in flight: triggers while one runs collapse into one more', async () => {
    const waits: ((v: ReturnType<typeof page>) => void)[] = []
    work.listNotifications.mockImplementation(
      () =>
        new Promise((resolve) => {
          waits.push(resolve)
        }),
    )
    await mount()
    expect(calls()).toBe(1)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(calls()).toBe(1)
    await act(async () => waits[0]!(page([row('n1')])))
    await flush()
    expect(calls()).toBe(2)
    await act(async () => waits[1]!(page([row('n1')])))
    await flush()
    expect(calls()).toBe(2)
    expect(ids()).toEqual(['n1'])
  })

  it('does not let a list that was in flight during an action undo the action', async () => {
    const waits: ((v: ReturnType<typeof page>) => void)[] = []
    work.listNotifications.mockResolvedValueOnce(page([row('n1')]))
    await mount()
    work.listNotifications.mockImplementation(
      () =>
        new Promise((resolve) => {
          waits.push(resolve)
        }),
    )
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    // the focus reload is still out when the person marks the row read
    await click(labelled(itemOf('n1'), 'Mark as read'))
    expect(itemOf('n1').querySelector('.wb-inbox-dot')).toBeNull()
    // the old answer still shows n1 unread: it must not land
    await act(async () => waits[0]!(page([row('n1')])))
    await flush()
    expect(itemOf('n1').querySelector('.wb-inbox-dot')).toBeNull()
    // the reload that follows the action is the truth
    await act(async () => waits[1]!(page([seen('n1')])))
    await flush()
    expect(itemOf('n1').querySelector('.wb-inbox-dot')).toBeNull()
  })
})

describe('Inbox unread badge', () => {
  function Badge({ workspaceId }: { workspaceId: string | null }) {
    const n = useInboxUnread(workspaceId)
    return createElement('span', { id: 'badge' }, n === null ? 'none' : String(n))
  }
  const badge = () => host.querySelector('#badge')!.textContent
  const draw = async (workspaceId: string | null = 'w') => {
    await act(async () => {
      root.render(createElement(Badge, { workspaceId }))
    })
    await flush()
  }

  it("reads this workspace's count from unread-count", async () => {
    work.unreadCount.mockResolvedValue(ok({ total: 9, by_workspace: { w: 3, other: 6 } }))
    await draw()
    expect(badge()).toBe('3')
  })

  it('counts zero for a workspace with no entry when the server lists others, else the total', async () => {
    work.unreadCount.mockResolvedValue(ok({ total: 6, by_workspace: { other: 6 } }))
    await draw()
    expect(badge()).toBe('0')
    work.unreadCount.mockResolvedValue(ok({ total: 5, by_workspace: {} }))
    await draw('w2')
    expect(badge()).toBe('5')
  })

  it('shows nothing before an answer, after a failure with no earlier answer, and with no workspace', async () => {
    work.unreadCount.mockResolvedValue({ ok: false, error: 'offline' })
    await draw()
    expect(badge()).toBe('none')
    await draw(null)
    expect(badge()).toBe('none')
    expect(work.unreadCount).toHaveBeenCalledTimes(1)
  })

  it('keeps the last count when a refresh fails', async () => {
    work.unreadCount.mockResolvedValueOnce(ok({ total: 2, by_workspace: { w: 2 } }))
    await draw()
    work.unreadCount.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(badge()).toBe('2')
  })

  it('refreshes on focus, on visibility, every 60 s, and when a notice changed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    work.unreadCount.mockResolvedValue(ok({ total: 1, by_workspace: { w: 1 } }))
    await draw()
    expect(work.unreadCount).toHaveBeenCalledTimes(1)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(work.unreadCount).toHaveBeenCalledTimes(2)
    work.unreadCount.mockResolvedValue(ok({ total: 0, by_workspace: { w: 0 } }))
    await act(async () => {
      window.dispatchEvent(new Event(NOTICES_CHANGED_EVENT))
    })
    await flush()
    expect(work.unreadCount).toHaveBeenCalledTimes(3)
    expect(badge()).toBe('0')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(work.unreadCount).toHaveBeenCalledTimes(4)
  })
})
