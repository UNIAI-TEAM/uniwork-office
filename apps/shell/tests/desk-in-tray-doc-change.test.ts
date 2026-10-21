/**
 * @vitest-environment jsdom
 */
import { act, createElement, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, UniworkLaunchEvent, UniworkWorkspaceRef } from '../src/shared/home-api'
import type {
  UniworkWorkApi,
  WorkHomeSummary,
  WorkNotification,
  WorkNotificationDocument,
} from '../src/shared/uniwork-work-api'
import { DeskInTray } from '../src/renderer/src/DeskInTray'
import { DeskToday } from '../src/renderer/src/DeskToday'
import { LocaleProvider } from '../src/renderer/src/locale'
import { onUniworkNotice } from '../src/renderer/src/uniwork-notice-bus'
import type { WorkLoad } from '../src/renderer/src/work-cache'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>
let work: {
  markNotificationsRead: ReturnType<typeof vi.fn>
  notificationDocuments: ReturnType<typeof vi.fn>
  openWeb: ReturnType<typeof vi.fn>
}
let notices: UniworkLaunchEvent[]
let offNotice: () => void

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = {
    uniworkListSharedWithMe: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    uniworkDocStatus: vi.fn(async () => null),
    onUniworkDocStatus: vi.fn(() => () => undefined),
    uniworkOpenDocument: vi.fn(async () => ({ ok: true, value: { path: '/c/x.docx' } })),
  }
  window.aiOffice = api as unknown as HomeApi
  work = {
    markNotificationsRead: vi.fn(async () => ({ ok: true, value: null })),
    notificationDocuments: vi.fn(async () => ({
      ok: true,
      value: { documents: [], next_cursor: null },
    })),
    openWeb: vi.fn(async () => true),
  }
  window.uniworkWork = work as unknown as UniworkWorkApi
  notices = []
  offNotice = onUniworkNotice((e) => notices.push(e))
})
afterEach(() => {
  offNotice()
  act(() => root.unmount())
  host.remove()
})

const flush = async () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })

const note = (over: Partial<WorkNotification> = {}): WorkNotification => ({
  id: 'n1',
  kind: 'document_changed',
  workspace_id: 'w',
  resource_type: 'document',
  resource_id: 'd1',
  actor_kind: 'user',
  title_key: 'x',
  params: { actor: 'Lan', verb: 'renamed' },
  created_at: '2026-10-14T03:00:00Z',
  ...over,
})
const changedMany = (over: Partial<WorkNotification> = {}) =>
  note({
    count: 5,
    sample_documents: [
      { id: 'a', title: 'Plan' },
      { id: 'b', title: 'Budget' },
    ],
    ...over,
  })
const changedOne = (over: Partial<WorkNotification> = {}) =>
  note({ count: 1, sample_documents: [{ id: 'd1', title: 'Plan' }], ...over })
const comment = (over: Partial<WorkNotification> = {}): WorkNotification => ({
  id: 'c1',
  kind: 'document_commented',
  workspace_id: 'w',
  resource_type: 'document',
  resource_id: 'd9',
  actor_kind: 'user',
  title_key: 'x',
  params: { actor: 'Minh', document: 'Contract-012' },
  created_at: '2026-10-14T01:00:00Z',
  ...over,
})
const docRow = (
  id: string,
  over: Partial<WorkNotificationDocument> = {},
): WorkNotificationDocument => ({
  id,
  title: `Doc ${id}`,
  kind: 'docx',
  trashed: false,
  shelved: false,
  deleted: false,
  ...over,
})
const page = (documents: WorkNotificationDocument[], next_cursor: string | null = null) => ({
  ok: true as const,
  value: { documents, next_cursor },
})

function summary(inbox: WorkNotification[], unread = inbox.length): WorkHomeSummary {
  return {
    today: '2026-10-14',
    timezone: '',
    counts: { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread },
    my_work: [],
    upcoming_meetings: [],
    inbox,
    partial: [],
    generated_at: '',
  } as WorkHomeSummary
}

/** the tray with a live home: marking a row read really removes it, as the page's cache does */
function Harness({ inbox }: { inbox: WorkNotification[] }): ReactElement {
  const [value, setValue] = useState(summary(inbox))
  const home: WorkLoad<WorkHomeSummary> = {
    value,
    updatedAt: 1,
    error: null,
    stale: false,
    reload: vi.fn(),
    update: (edit) => setValue(edit),
  }
  return createElement(DeskInTray, { home, signedIn: true, view: 'ready', local: [] })
}

async function render(el: ReactElement, lang: 'en' | 'vi' = 'en') {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: lang }, el))
  })
  await flush()
}
const tray = (inbox: WorkNotification[], lang: 'en' | 'vi' = 'en') =>
  render(createElement(Harness, { inbox }), lang)

const buttons = () => Array.from(host.ownerDocument.querySelectorAll('button'))
const button = (label: string) => buttons().find((b) => b.textContent?.includes(label))
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const rowOf = (text: string) =>
  Array.from(host.querySelectorAll<HTMLElement>('.uw-pick-row')).find((r) =>
    r.textContent?.includes(text),
  )
const click = async (el: HTMLElement | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => el!.click())
  await flush()
}
const pressEsc = async () => {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
  })
  await flush()
}

describe('document_changed tray row (G6)', () => {
  it('words a one-document change with its sentence and pill, then opens it and marks it read', async () => {
    await tray([changedOne()])
    const row = rowOf('Lan renamed “Plan”')!
    expect(row).toBeTruthy()
    expect(row.closest('li')!.querySelector('.wb-pill')!.textContent).toBe('Changed')
    await click(button('Lan renamed “Plan”'))
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d1')
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
    // read: the row leaves the tray
    expect(rowOf('Lan renamed')).toBeUndefined()
    expect(dialog()).toBeNull()
  })

  it('keeps a one-document change when it fails to open', async () => {
    api.uniworkOpenDocument.mockResolvedValueOnce({ ok: false, error: 'not_found' })
    await tray([changedOne()])
    await click(button('Lan renamed “Plan”'))
    expect(work.markNotificationsRead).not.toHaveBeenCalled()
    expect(rowOf('Lan renamed')).toBeTruthy()
  })

  it('shows the sample titles and "and N more" for a several-document change, and opens the list', async () => {
    work.notificationDocuments.mockResolvedValue(page([docRow('a')]))
    await tray([changedMany()])
    const row = rowOf('Lan renamed 5 documents')!
    expect(row.textContent).toContain('Plan, Budget and 3 more')
    await click(button('Lan renamed 5 documents'))
    expect(dialog()).not.toBeNull()
    expect(dialog()!.getAttribute('aria-modal')).toBe('true')
    expect(dialog()!.textContent).toContain('Changed documents')
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    // read once the first page is loaded, not after a document was picked
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
  })

  it('keeps the notice unread while the first page is loading or failed, and reads it once loaded', async () => {
    let release!: (v: ReturnType<typeof page>) => void
    work.notificationDocuments
      .mockResolvedValueOnce({ ok: false, error: 'server' })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve
        }),
      )
    await tray([changedMany()])
    await click(button('Lan renamed 5 documents'))
    expect(dialog()!.textContent).toContain("Couldn't load the documents")
    expect(work.markNotificationsRead).not.toHaveBeenCalled()
    await click(button('Retry'))
    expect(work.markNotificationsRead).not.toHaveBeenCalled()
    await act(async () => release(page([docRow('a')])))
    await flush()
    expect(work.markNotificationsRead).toHaveBeenCalledTimes(1)
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
  })

  it('carries the whole notice sentence as the title attribute of the row name', async () => {
    await tray([changedOne({})])
    const name = host.querySelector<HTMLElement>('.wb-desk-row-title')!
    expect(name.getAttribute('title')).toBe(name.textContent)
    expect(name.textContent).not.toBe('')
  })

  it('clears a one-document change with no title even when its open fails', async () => {
    api.uniworkOpenDocument.mockResolvedValueOnce({ ok: false, error: 'forbidden' })
    await tray([
      changedOne({ params: { actor: 'Lan', verb: 'access_changed' }, sample_documents: [] }),
    ])
    await click(
      host.querySelector<HTMLElement>('.wb-desk-row-title, .uw-pick-row button, .uw-pick-row'),
    )
    expect(api.uniworkOpenDocument).toHaveBeenCalled()
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
  })

  it('does not open anything for a count-1 document that was deleted or trashed; it only marks read', async () => {
    await tray([changedOne({ params: { actor: 'Lan', verb: 'trashed' } })])
    const row = rowOf('Lan moved “Plan” to trash')!
    expect(row.className).toContain('is-gone')
    // the pill is a sibling of the row inside li.uw-pick-item, so the dim rule must use ~
    expect(row.nextElementSibling!.matches('.wb-desk-trail')).toBe(true)
    expect(row.parentElement!.matches('.uw-pick-item')).toBe(true)
    expect(row.querySelector('.wb-pill')).toBeNull()
    expect(row.matches('.uw-pick-row.is-gone ~ .wb-desk-trail')).toBe(false)
    expect(row.nextElementSibling!.querySelector('.wb-pill')).not.toBeNull()
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/home.css'), 'utf8')
    expect(css).toMatch(/\.uw-pick-row\.is-gone ~ \.wb-desk-trail \.wb-pill \{\s*opacity: 0\.6;/)
    await click(button('Lan moved “Plan” to trash'))
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
  })

  it('reads in Vietnamese', async () => {
    work.notificationDocuments.mockResolvedValue(page([docRow('a')]))
    await tray([changedMany()], 'vi')
    const row = rowOf('Lan đã đổi tên 5 tài liệu')!
    expect(row.closest('li')!.querySelector('.wb-pill')!.textContent).toBe('Đã thay đổi')
    expect(row.textContent).toContain('Plan, Budget và 3 tài liệu khác')
    await click(button('Lan đã đổi tên 5 tài liệu'))
    expect(dialog()!.textContent).toContain('Tài liệu thay đổi')
  })
})

describe('DocChangeDialog (G7)', () => {
  const openList = async (inbox: WorkNotification[] = [changedMany()]) => {
    await tray(inbox)
    await click(button('Lan renamed 5 documents'))
  }

  it('loads the first page with limit 50 and shows a loading state meanwhile', async () => {
    let release!: (v: ReturnType<typeof page>) => void
    work.notificationDocuments.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await openList()
    expect(work.notificationDocuments).toHaveBeenCalledWith('n1', { limit: 50 })
    expect(dialog()!.textContent).toContain('Loading the documents')
    await act(async () => release(page([docRow('a', { title: 'Plan' })])))
    await flush()
    expect(dialog()!.textContent).not.toContain('Loading the documents')
    expect(dialog()!.textContent).toContain('Plan')
  })

  it('shows an error with Retry that loads again', async () => {
    work.notificationDocuments
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce(page([docRow('a', { title: 'Plan' })]))
    await openList()
    expect(dialog()!.textContent).toContain("Couldn't load the documents")
    expect(dialog()!.textContent).toContain('Something went wrong, try again')
    await click(
      Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Retry'),
    )
    expect(work.notificationDocuments).toHaveBeenCalledTimes(2)
    expect(dialog()!.textContent).toContain('Plan')
    expect(dialog()!.textContent).not.toContain("Couldn't load the documents")
  })

  it('treats a thrown call as the error state', async () => {
    work.notificationDocuments.mockRejectedValueOnce(new Error('ipc'))
    await openList()
    expect(dialog()!.textContent).toContain("Couldn't load the documents")
  })

  it('treats a synchronous throw from the bridge as the error state', async () => {
    work.notificationDocuments.mockImplementationOnce(() => {
      throw new Error('no bridge')
    })
    await openList()
    expect(dialog()!.textContent).toContain("Couldn't load the documents")
  })

  it('marks Load more busy while the next page loads', async () => {
    let release!: (v: ReturnType<typeof page>) => void
    work.notificationDocuments.mockResolvedValueOnce(page([docRow('a')], 'c1')).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await openList()
    const more = () => dialog()!.querySelector<HTMLElement>('.wb-docchange-more')!
    expect(more().getAttribute('aria-busy')).not.toBe('true')
    await click(more())
    expect(more().getAttribute('aria-busy')).toBe('true')
    await act(async () => release(page([docRow('b')])))
    await flush()
    expect(dialog()!.querySelector('.wb-docchange-more')).toBeNull()
  })

  it('says so when no readable document is left', async () => {
    work.notificationDocuments.mockResolvedValue(page([]))
    await openList()
    expect(dialog()!.textContent).toContain('No document you can read is left')
    expect(dialog()!.textContent).toContain(
      'These documents were deleted or you no longer have access.',
    )
    expect(dialog()!.textContent).not.toContain('Load more')
  })

  it('lists documents; a normal row opens the document and closes the dialog', async () => {
    work.notificationDocuments.mockResolvedValue(
      page([docRow('a', { title: 'Plan' }), docRow('b', { title: 'Budget' })]),
    )
    await openList()
    await click(
      Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Budget'),
    )
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('b')
    expect(dialog()).toBeNull()
  })

  it('shows deleted and trashed rows muted with their state, never as links', async () => {
    work.notificationDocuments.mockResolvedValue(
      page([
        docRow('a', { title: 'Plan' }),
        docRow('b', { title: 'Old', deleted: true }),
        docRow('c', { title: 'Bin', trashed: true }),
        docRow('d', { title: '', deleted: true }),
      ]),
    )
    await openList()
    const items = Array.from(dialog()!.querySelectorAll<HTMLElement>('li'))
    const old = items.find((li) => li.textContent?.includes('Old'))!
    const bin = items.find((li) => li.textContent?.includes('Bin'))!
    expect(old.className).toContain('is-gone')
    expect(old.querySelector('button')).toBeNull()
    expect(old.textContent).toContain('Permanently deleted')
    expect(bin.querySelector('button')).toBeNull()
    expect(bin.textContent).toContain('Moved to trash')
    // a blank title on a gone row reads as the muted untitled name, with the tag on the same line
    const blank = items.find((li) => li.textContent === 'Untitled documentPermanently deleted')
    expect(blank).toBeTruthy()
    expect(blank!.querySelector('.wb-docchange-name')?.textContent).toBe('Untitled document')
    expect(
      items.find((li) => li.textContent?.includes('Plan'))!.querySelector('button'),
    ).not.toBeNull()
    await click(old)
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
  })

  it('names an untitled normal document with the untitled text', async () => {
    work.notificationDocuments.mockResolvedValue(page([docRow('a', { title: '   ' })]))
    await openList()
    expect(
      Array.from(dialog()!.querySelectorAll('button')).some(
        (b) => b.textContent === 'Untitled document',
      ),
    ).toBe(true)
  })

  it('loads more by next_cursor and appends, even when a page is short', async () => {
    work.notificationDocuments
      .mockResolvedValueOnce(page([docRow('a', { title: 'First' })], 'cur-1'))
      .mockResolvedValueOnce(page([docRow('b', { title: 'Second' })], 'cur-2'))
      .mockResolvedValueOnce(page([docRow('c', { title: 'Third' })], null))
    await openList()
    // a short first page (1 of 50) still offers more: the server decides, not the page size
    expect(button('Load more')).toBeTruthy()
    await click(button('Load more'))
    expect(work.notificationDocuments).toHaveBeenNthCalledWith(2, 'n1', {
      cursor: 'cur-1',
      limit: 50,
    })
    expect(dialog()!.textContent).toContain('First')
    expect(dialog()!.textContent).toContain('Second')
    await click(button('Load more'))
    expect(work.notificationDocuments).toHaveBeenNthCalledWith(3, 'n1', {
      cursor: 'cur-2',
      limit: 50,
    })
    expect(dialog()!.textContent).toContain('Third')
    expect(button('Load more')).toBeUndefined()
  })

  it('keeps the loaded documents when a later page fails, and the button tries again', async () => {
    work.notificationDocuments
      .mockResolvedValueOnce(page([docRow('a', { title: 'First' })], 'cur-1'))
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce(page([docRow('b', { title: 'Second' })], null))
    await openList()
    await click(button('Load more'))
    expect(dialog()!.textContent).toContain('First')
    expect(dialog()!.querySelector('[role="alert"]')).not.toBeNull()
    await click(button('Load more'))
    expect(dialog()!.textContent).toContain('Second')
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows Load more alone when the first page held nothing readable but more follow', async () => {
    work.notificationDocuments.mockResolvedValueOnce(page([], 'cur-1'))
    await openList()
    expect(dialog()!.textContent).not.toContain('No document you can read is left')
    expect(button('Load more')).toBeTruthy()
  })

  it('closes on Escape and gives focus back to the opener when the row is still there', async () => {
    work.markNotificationsRead.mockResolvedValue({ ok: false, error: 'offline' })
    work.notificationDocuments.mockResolvedValue(page([docRow('a')]))
    await tray([changedMany()])
    const opener = button('Lan renamed 5 documents')!
    opener.focus()
    await click(opener)
    expect(dialog()).not.toBeNull()
    // focus moved into the dialog
    expect(dialog()!.contains(document.activeElement)).toBe(true)
    await pressEsc()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('returns focus to the tray when the opening row was marked read and left', async () => {
    work.notificationDocuments.mockResolvedValue(page([docRow('a')]))
    await tray([changedMany(), comment()])
    const opener = button('Lan renamed 5 documents')!
    opener.focus()
    await click(opener)
    expect(rowOf('Lan renamed')).toBeUndefined()
    await pressEsc()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('.wb-desk-row-title'))
    expect(host.contains(document.activeElement)).toBe(true)
  })

  it('keeps Tab inside the dialog', async () => {
    work.notificationDocuments.mockResolvedValue(
      page([docRow('a', { title: 'Plan' }), docRow('b', { title: 'Budget' })]),
    )
    await openList()
    const stops = Array.from(dialog()!.querySelectorAll<HTMLElement>('button'))
    stops[stops.length - 1]!.focus()
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      )
    })
    expect(dialog()!.contains(document.activeElement)).toBe(true)
  })

  it('loads again on every open, without a cache', async () => {
    work.markNotificationsRead.mockResolvedValue({ ok: false, error: 'offline' })
    work.notificationDocuments.mockResolvedValue(page([docRow('a')]))
    await tray([changedMany()])
    await click(button('Lan renamed 5 documents'))
    await pressEsc()
    await click(button('Lan renamed 5 documents'))
    expect(work.notificationDocuments).toHaveBeenCalledTimes(2)
  })

  it('reads in Vietnamese', async () => {
    work.notificationDocuments.mockResolvedValue(page([docRow('b', { deleted: true })]))
    await tray([changedMany()], 'vi')
    await click(button('Lan đã đổi tên 5 tài liệu'))
    expect(dialog()!.textContent).toContain('Đã xóa vĩnh viễn')
  })
})

describe('comment-resolved row (G8)', () => {
  const resolved = (over: Partial<WorkNotification> = {}): WorkNotification => ({
    id: 'r1',
    kind: 'document_comment_resolved',
    workspace_id: 'w',
    resource_type: 'document',
    resource_id: 'd5',
    actor_kind: 'user',
    title_key: 'x',
    params: { actor: 'Lan', document: 'Contract-012', comment_id: 'k1' },
    created_at: '2026-10-14T02:00:00Z',
    ...over,
  })

  it('shows the Resolved pill and sentence, then opens the document (no comment link)', async () => {
    await tray([resolved()])
    const row = rowOf('Contract-012')!
    expect(row.closest('li')!.querySelector('.wb-pill')!.textContent).toBe('Resolved')
    expect(row.textContent).toContain('Lan marked a comment in “Contract-012” as resolved.')
    await click(button('Contract-012'))
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d5')
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['r1'])
  })

  it('has a name for a resolved comment on an untitled document', async () => {
    await tray([resolved({ params: { actor: 'Lan' } })])
    expect(button('Lan marked a comment as resolved.')).toBeTruthy()
  })
})

describe('deleted and no-access rows (G9)', () => {
  it('dims a deleted document, says so, and only marks read with a notice', async () => {
    await tray([comment({ resource_deleted: true })])
    const row = rowOf('Contract-012')!
    expect(row.className).toContain('is-gone')
    expect(row.textContent).toContain('This document was deleted in UniWork.')
    await click(button('Contract-012'))
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['c1'])
    expect(notices).toContainEqual({ phase: 'failed', error: 'deleted' })
    expect(rowOf('Contract-012')).toBeUndefined()
  })

  it('dims a document that is out of reach, says so, and never tries to open it', async () => {
    await tray([comment({ resource_access_lost: true })])
    const row = rowOf('Contract-012')!
    expect(row.className).toContain('is-gone')
    expect(row.textContent).toContain('You don’t have access to this document.')
    expect(row.textContent).not.toContain('permission to do that')
    await click(button('Contract-012'))
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['c1'])
    expect(notices).toContainEqual({ phase: 'failed', error: 'forbidden' })
  })

  it('applies to a document change and to a comment-resolved row alike', async () => {
    await tray([
      changedOne({ resource_deleted: true }),
      comment({ id: 'c2', resource_access_lost: true }),
    ])
    await click(button('Lan renamed “Plan”'))
    await click(button('Contract-012'))
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(work.markNotificationsRead).toHaveBeenCalledTimes(2)
  })

  it('keeps the row quietly when marking read is refused', async () => {
    work.markNotificationsRead.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await tray([comment({ resource_deleted: true })])
    await click(button('Contract-012'))
    expect(rowOf('Contract-012')).toBeTruthy()
  })
})

describe('Today foot count (G10)', () => {
  it('counts a folded 40-document change once among the other notifications', async () => {
    const ws = { id: 'w', name: 'Team', orgId: 'o1', slug: 'team', orgSlug: 'acme' }
    const inbox = [
      changedMany({ count: 40 }),
      comment(),
      {
        ...comment({ id: 'x1', kind: 'task_assigned', resource_type: 'task' }),
      },
    ]
    // unread totals every row (3), the tray holds two of them: one is left for the foot
    const value = summary(inbox, 3)
    const home: WorkLoad<WorkHomeSummary> = {
      value,
      updatedAt: 1,
      error: null,
      stale: false,
      reload: vi.fn(),
      update: vi.fn(),
    }
    await render(
      createElement(DeskToday, {
        home,
        view: 'ready',
        workspace: ws as unknown as UniworkWorkspaceRef,
        onReload: vi.fn(),
        onOpenTasks: vi.fn(),
      }),
    )
    expect(host.textContent).toContain('Other notifications on UniWork: 1')
  })
})
