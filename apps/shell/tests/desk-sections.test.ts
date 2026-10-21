/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, RecentEntry } from '../src/shared/home-api'
import type { TabsApi } from '../src/shared/tabs-api'
import type { UniworkWorkApi, WorkHomeSummary } from '../src/shared/uniwork-work-api'
import { DeskDrawer } from '../src/renderer/src/DeskDrawer'
import { DeskInProgress } from '../src/renderer/src/DeskInProgress'
import { DeskInTray } from '../src/renderer/src/DeskInTray'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WbToastHost, createWbToasts } from '../src/renderer/src/WbToastHost'
import type { WorkLoad } from '../src/renderer/src/work-cache'
import { readForms, writeForms } from '../src/renderer/src/workbench-pins'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>
let work: {
  markNotificationsRead: ReturnType<typeof vi.fn>
  myProfile: ReturnType<typeof vi.fn>
}

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
    openPath: vi.fn(async () => undefined),
    revealPath: vi.fn(async () => undefined),
    browse: vi.fn(async () => undefined),
    accountLogin: vi.fn(async () => true),
    newDoc: vi.fn(async () => undefined),
  }
  window.aiOffice = api as unknown as HomeApi
  // Node's own localStorage global shadows jsdom's (no clear()): a fresh Map per test, so forms don't leak
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
  work = {
    markNotificationsRead: vi.fn(async () => ({ ok: true, value: null })),
    myProfile: vi.fn(async () => ({ ok: false, error: 'signed-out' })),
  }
  window.uniworkWork = work as unknown as UniworkWorkApi
  window.aiOfficeTabs = { activate: vi.fn(async () => undefined) } as unknown as TabsApi
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(el: ReactElement) {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, el))
  })
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes(label))

function home(inbox: WorkHomeSummary['inbox']): WorkLoad<WorkHomeSummary> {
  const value = {
    today: '2026-10-14',
    timezone: '',
    counts: { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 },
    my_work: [],
    upcoming_meetings: [],
    inbox,
    partial: [],
    generated_at: '',
  } as WorkHomeSummary
  return { value, updatedAt: 1, error: null, stale: false, reload: vi.fn(), update: vi.fn() }
}
const comment = {
  id: 'n1',
  kind: 'document_commented',
  workspace_id: 'w',
  resource_type: 'document',
  resource_id: 'd1',
  actor_kind: 'user',
  title_key: 'x',
  params: { actor: 'Lan', document: 'Contract-012' },
  created_at: '2026-10-14T01:00:00Z',
}

describe('DeskInTray', () => {
  it('opens a commented document, then marks the notification read and drops it', async () => {
    const h = home([comment])
    await render(createElement(DeskInTray, { home: h, signedIn: true, view: 'ready', local: [] }))
    expect(host.textContent).toContain('Contract-012')
    // a person's comment: an info pill; the date is the picker list's Cập nhật cell (shared formatter)
    expect(host.querySelector('.wb-pill.is-info')!.textContent).toBe('Comment')
    expect(host.querySelector('.uw-pick-row [data-col="updated"]')!.textContent).toMatch(
      /^\d{2}\/\d{2}(\/\d{4})?$|^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$|^\d{2}:\d{2}$|^Yesterday, \d{2}:\d{2}$/,
    )
    await act(async () => button('Contract-012')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d1')
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
    expect(h.update).toHaveBeenCalledTimes(1)
    // the read note leaves the unread total too, so "Other notifications" does not rise
    const edit = vi.mocked(h.update).mock.calls[0]![0]
    const before = { ...h.value!, counts: { ...h.value!.counts, unread: 5 } }
    const after = edit(before)
    expect(after.counts.unread).toBe(4)
    expect(after.inbox).toEqual([])
    expect(edit({ ...before, counts: { ...before.counts, unread: 0 } }).counts.unread).toBe(0)
  })

  it('keeps the row quietly when marking read fails', async () => {
    work.markNotificationsRead.mockResolvedValueOnce({ ok: false, error: 'offline' })
    const h = home([comment])
    await render(createElement(DeskInTray, { home: h, signedIn: true, view: 'ready', local: [] }))
    await act(async () => button('Contract-012')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.uniworkOpenDocument).toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps the reminder when the document fails to open', async () => {
    api.uniworkOpenDocument.mockResolvedValueOnce({ ok: false, error: 'not_found' })
    const h = home([comment])
    await render(createElement(DeskInTray, { home: h, signedIn: true, view: 'ready', local: [] }))
    await act(async () => button('Contract-012')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(work.markNotificationsRead).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('moves focus to the first newly shown row after Show more', async () => {
    const notes = Array.from({ length: 9 }, (_, i) => ({
      ...comment,
      id: `n${i}`,
      resource_id: `d${i}`,
      params: { actor: 'Lan', document: `Doc-${i}` },
    }))
    await render(
      createElement(DeskInTray, { home: home(notes), signedIn: true, view: 'ready', local: [] }),
    )
    const titles = () => host.querySelectorAll<HTMLButtonElement>('.wb-desk-row-title')
    expect(titles()).toHaveLength(8)
    // "Show more" sits under the list, not inside it as a fake row
    expect(host.querySelector('.dh-picker ul .wb-link')).toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('.wb-link')!.click())
    expect(titles()).toHaveLength(9)
    expect(document.activeElement).toBe(titles()[8])
  })

  it('lists the tray on the compact picker variant of the shared DocList', async () => {
    const shared = {
      id: 's1',
      workspaceId: 'w',
      title: 'Plan',
      format: 'docx',
      updatedAt: new Date().toISOString(),
      updatedByName: 'Minh Trần',
      workspaceName: 'Legal',
    }
    api.uniworkListSharedWithMe.mockResolvedValueOnce({
      ok: true,
      value: { documents: [shared], nextCursor: null },
    })
    api.uniworkDocStatus.mockResolvedValue({
      path: '/c/p.docx',
      documentId: 'd9',
      workspaceId: 'w',
      title: 'Proposal',
      format: 'docx',
      access: 'edit',
      state: 'conflict',
    })
    const local = [
      {
        path: '/c/p.docx',
        name: 'p.docx',
        ext: 'docx',
        mtimeMs: 1,
        sizeBytes: 1,
        starred: false,
        uniwork: { documentId: 'd9' },
      } as RecentEntry,
    ]
    await render(
      createElement(DeskInTray, { home: home([comment]), signedIn: true, view: 'ready', local }),
    )
    // a plain list: the title button is the control, so no listbox / option / aria-selected
    expect(host.querySelector('[role="listbox"], [role="option"], [aria-selected]')).toBeNull()
    const list = host.querySelector('.dh-picker ul[role="list"]')!
    expect(list.getAttribute('aria-label')).toBe('Needs you')
    // the quiet picker header: Tên · Cập nhật (Người sửa joins once the card is wide enough), nothing sortable
    const head = host.querySelector('.dh-picker-head')!
    expect(head.getAttribute('aria-hidden')).toBe('true')
    expect(head.textContent).toContain('Name')
    expect(head.querySelector('button')).toBeNull()
    // no second table: no Chọn / Access / Size / Actions columns
    expect(host.querySelector('.wb-desk-row')).toBeNull()
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    const items = Array.from(list.querySelectorAll(':scope > li'))
    // the tray's own order is kept: sync problem, comment, then the share
    expect(items.map((li) => li.querySelector('.wb-row-title')!.textContent)).toEqual([
      'Proposal',
      'Contract-012',
      'Plan',
    ])
    for (const li of items) {
      expect(li.querySelector(':scope > .uw-pick-row .wb-row-title')).not.toBeNull()
      // the pill sits beside the option in the same item
      expect(li.querySelector(':scope > .wb-desk-trail .wb-pill')).not.toBeNull()
      expect(li.querySelector(':scope > .uw-pick-row [data-col="updated"]')).not.toBeNull()
    }
    // second line: why the row is here (the share names its workspace); the date of a
    // sync problem that has no save time reads as an empty cell, not a blank
    expect(items[0]!.querySelector('.uw-pick-row-meta')!.textContent).toBe(
      'This copy and the one on UniWork differ',
    )
    expect(items[0]!.querySelector('[data-col="updated"]')!.textContent).toBe('—')
    expect(items[2]!.querySelector('.uw-pick-row-meta')!.textContent).toBe(
      'Shared with you · Legal',
    )
    // Resolve stays a visible, labelled button beside its row only for a sync problem
    expect(items[0]!.querySelector(':scope > .wb-desk-trail .wb-desk-row-act')).not.toBeNull()
    expect(items[1]!.querySelector('.wb-desk-row-act')).toBeNull()
    expect(items[2]!.querySelector('.wb-desk-row-act')).toBeNull()
  })

  it('opens a row from anywhere on it, once', async () => {
    await render(
      createElement(DeskInTray, {
        home: home([comment]),
        signedIn: true,
        view: 'ready',
        local: [],
      }),
    )
    await act(async () =>
      host.querySelector<HTMLElement>('.uw-pick-row [data-col="updated"]')!.click(),
    )
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.uniworkOpenDocument).toHaveBeenCalledTimes(1)
    await act(async () => button('Contract-012')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.uniworkOpenDocument).toHaveBeenCalledTimes(2)
  })

  it('shows a sync problem from a working copy', async () => {
    api.uniworkDocStatus.mockResolvedValue({
      path: '/c/p.docx',
      documentId: 'd9',
      workspaceId: 'w',
      title: 'Proposal',
      format: 'docx',
      access: 'edit',
      state: 'conflict',
    })
    const local = [
      {
        path: '/c/p.docx',
        name: 'p.docx',
        ext: 'docx',
        mtimeMs: 1,
        sizeBytes: 1,
        starred: false,
        uniwork: { documentId: 'd9' },
      } as RecentEntry,
    ]
    await render(
      createElement(DeskInTray, { home: home([]), signedIn: true, view: 'ready', local }),
    )
    expect(host.textContent).toContain('Proposal')
    expect(host.textContent).toContain('This copy and the one on UniWork differ')
    // the most serious state is the loudest: a danger pill and a visible Resolve
    expect(host.querySelector('.wb-pill.is-danger')!.textContent).toBe('Conflict')
    const resolve = button('Resolve')!
    expect(resolve.className).toContain('wb-btn-secondary')
    // a screen reader hears which document Resolve is for
    expect(document.getElementById(resolve.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Proposal',
    )
    await act(async () => resolve.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d9')
  })

  it('shows a failed sync as a danger "Not synced" pill with Resolve', async () => {
    api.uniworkDocStatus.mockResolvedValue({
      path: '/c/p.docx',
      documentId: 'd9',
      workspaceId: 'w',
      title: 'Proposal',
      format: 'docx',
      access: 'edit',
      state: 'failed',
    })
    const local = [
      {
        path: '/c/p.docx',
        name: 'p.docx',
        ext: 'docx',
        mtimeMs: 1,
        sizeBytes: 1,
        starred: false,
        uniwork: { documentId: 'd9' },
      } as RecentEntry,
    ]
    await render(
      createElement(DeskInTray, { home: home([]), signedIn: true, view: 'ready', local }),
    )
    expect(host.querySelector('.wb-pill.is-danger')!.textContent).toBe('Not synced')
    expect(button('Resolve')).toBeDefined()
  })

  it('marks a mention info and a new share neutral', async () => {
    api.uniworkListSharedWithMe.mockResolvedValueOnce({
      ok: true,
      value: {
        documents: [
          {
            id: 's1',
            workspaceId: 'w',
            title: 'Plan',
            format: 'docx',
            updatedAt: new Date().toISOString(),
          },
        ],
        nextCursor: null,
      },
    })
    await render(
      createElement(DeskInTray, {
        home: home([{ ...comment, kind: 'document_mentioned' }]),
        signedIn: true,
        view: 'ready',
        local: [],
      }),
    )
    const pills = Array.from(host.querySelectorAll('.wb-pill')).map((p) => [
      p.textContent,
      p.className,
    ])
    expect(pills).toEqual([
      ['Mention', 'wb-pill is-info'],
      ['Newly shared', 'wb-pill'],
    ])
  })

  it('reloads "Shared with you" on the top bar Refresh', async () => {
    const props = { home: home([]), signedIn: true, view: 'ready' as const, local: [] }
    await render(createElement(DeskInTray, { ...props, refreshTick: 0 }))
    expect(api.uniworkListSharedWithMe).toHaveBeenCalledTimes(1)
    await render(createElement(DeskInTray, { ...props, refreshTick: 1 }))
    expect(api.uniworkListSharedWithMe).toHaveBeenCalledTimes(2)
  })

  it('leaves the sign-in prompt to the Desk banner when signed out', async () => {
    await render(
      createElement(DeskInTray, {
        home: { ...home([]), value: null },
        signedIn: false,
        view: 'signed-out',
        local: [],
      }),
    )
    expect(api.uniworkListSharedWithMe).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Sign in')
    expect(host.querySelector('button')).toBeNull()
    expect(host.textContent).toContain('Nothing from UniWork yet')
  })

  it('offers Retry, not "nothing waiting", when the notifications failed to load', async () => {
    const h = home([])
    const onReload = vi.fn()
    await render(
      createElement(DeskInTray, {
        home: { ...h, value: { ...h.value!, partial: ['notifications'] } },
        signedIn: true,
        view: 'ready',
        local: [],
        onReload,
      }),
    )
    expect(host.textContent).not.toContain('Nothing is waiting on you')
    expect(host.textContent).not.toContain('Sign in')
    await act(async () => host.querySelector<HTMLButtonElement>('.wb-ov-partial .wb-link')!.click())
    expect(onReload).toHaveBeenCalled()
  })

  it('shows neither a sign-in prompt nor the empty panel while loading', async () => {
    await render(
      createElement(DeskInTray, {
        home: { ...home([]), value: null },
        signedIn: false,
        view: 'loading',
        local: [],
      }),
    )
    expect(host.textContent).not.toContain('Nothing is waiting on you')
    expect(host.textContent).not.toContain('Sign in')
    expect(host.querySelector('.wb-ov-partial')).toBeNull()
    expect(host.querySelector('.wb-work-skeleton')).not.toBeNull()
    // loading is announced, not silent
    const skel = host.querySelector('.wb-work-skeleton')!
    expect(skel.getAttribute('role')).toBe('status')
    expect(skel.getAttribute('aria-label')).toBe('Loading…')
  })

  it('says there is no workspace instead of inviting sign-in', async () => {
    await render(
      createElement(DeskInTray, {
        home: { ...home([]), value: null },
        signedIn: false,
        view: 'no-workspace',
        local: [],
      }),
    )
    expect(host.textContent).not.toContain('Sign in')
    expect(host.querySelector('.wb-ov-note')).not.toBeNull()
  })
})

describe('DeskInProgress', () => {
  it('switches to an unsaved tab and opens a recovery copy', async () => {
    await render(
      createElement(DeskInProgress, {
        drafts: [
          { kind: 'unsaved', title: 'Report', app: 'docs', tabId: 't1', filePath: '/w/r.docx' },
          {
            kind: 'recovery',
            title: 'old.xlsx',
            app: 'sheets',
            filePath: '/w/old.xlsx',
            modifiedMs: 1,
          },
        ],
        recent: [],
        local: [],
      }),
    )
    expect(host.textContent).toContain('Unsaved')
    expect(host.textContent).toContain('Recovered copy')
    await act(async () => button('Report')!.click())
    expect(window.aiOfficeTabs.activate).toHaveBeenCalledWith('t1')
    await act(async () => button('old.xlsx')!.click())
    expect(api.openPath).toHaveBeenCalledWith('/w/old.xlsx')
  })

  it('offers Open file in the card head, and says when nothing is in progress', async () => {
    await render(createElement(DeskInProgress, { drafts: [], recent: [], local: [] }))
    expect(host.textContent).toContain('No documents in progress')
    const open = button('Open file')!
    expect(open.closest('.wb-desk-head')).not.toBeNull()
    await act(async () => open.click())
    expect(api.browse).toHaveBeenCalled()
  })

  it('a failed UniWork list says so with Retry instead of posing as nothing in progress', async () => {
    const onRetry = vi.fn()
    await render(
      createElement(DeskInProgress, {
        drafts: [],
        recent: [],
        local: [],
        cloudFailed: true,
        onRetry,
      }),
    )
    expect(host.textContent).not.toContain('No documents in progress')
    const line = host.querySelector('.wb-desk-card > .wb-ov-partial')!
    expect(line.textContent).toContain('Couldn’t load your UniWork documents')
    await act(async () => line.querySelector('button')!.click())
    expect(onRetry).toHaveBeenCalled()
  })

  it('Retry says it is trying while the list is asked again, so the click never looks dead', async () => {
    const onRetry = vi.fn()
    await render(
      createElement(DeskInProgress, {
        drafts: [],
        recent: [],
        local: [],
        cloudFailed: true,
        retrying: true,
        onRetry,
      }),
    )
    const retry = host.querySelector<HTMLButtonElement>('.wb-ov-partial button')!
    expect(retry.textContent).toBe('Loading…')
    expect(retry.getAttribute('aria-disabled')).toBe('true')
    await act(async () => retry.click())
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('a Retry that succeeds hands the focus to the section, not <body>', async () => {
    const props = { drafts: [], recent: [], local: [], onRetry: vi.fn() }
    await render(createElement(DeskInProgress, { ...props, cloudFailed: true }))
    host.querySelector<HTMLButtonElement>('.wb-ov-partial button')!.focus()
    await render(createElement(DeskInProgress, { ...props, cloudFailed: false }))
    expect(host.querySelector('.wb-ov-partial')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('section.wb-desk-card'))
  })

  it('shows a skeleton, not the empty line, while drafts or recents load', async () => {
    await render(
      createElement(DeskInProgress, { drafts: [], recent: [], local: [], loading: true }),
    )
    expect(host.querySelector('.wb-work-skeleton')).not.toBeNull()
    expect(host.textContent).not.toContain('No documents in progress')
  })

  it('gives each draft its pill and a visible secondary action', async () => {
    await render(
      createElement(DeskInProgress, {
        drafts: [
          { kind: 'unsaved', title: 'Report', app: 'docs', tabId: 't1' },
          { kind: 'recovery', title: 'old.xlsx', app: 'sheets', filePath: '/w/old.xlsx' },
        ],
        recent: [],
        local: [],
      }),
    )
    expect(host.querySelector('.wb-pill.is-warning')!.textContent).toBe('Unsaved')
    expect(host.querySelector('.wb-pill.is-info')!.textContent).toBe('Recovered copy')
    await act(async () => button('Restore')!.click())
    expect(api.openPath).toHaveBeenCalledWith('/w/old.xlsx')
    const switchTo = button('Switch to')!
    expect(switchTo.className).toContain('wb-btn-secondary')
    // each row's action is described by its title, so a list of buttons tells them apart
    expect(document.getElementById(switchTo.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Report',
    )
    expect(
      document.getElementById(button('Restore')!.getAttribute('aria-describedby')!)?.textContent,
    ).toBe('old.xlsx')
    expect(switchTo.getAttribute('aria-hidden')).toBeNull()
    await act(async () => switchTo.click())
    expect(window.aiOfficeTabs.activate).toHaveBeenCalledWith('t1')
  })
})

describe('DeskDrawer', () => {
  it('drafts a form into the pack, and sends Manage to the Forms tab', async () => {
    writeForms('legal', [{ id: 'f1', title: 'Quote' }])
    const onManage = vi.fn()
    await render(
      createElement(DeskDrawer, {
        practiceId: 'legal',
        packId: 'p1',
        orgId: null,
        vi: false,
        onManage,
      }),
    )
    await act(async () => button('Quote')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.newDoc).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }))
    await act(async () => button('Manage')!.click())
    expect(onManage).toHaveBeenCalled()
  })

  it('links the drafted form to the pack, like the Forms tab, and tells the page', async () => {
    writeForms('legal', [
      { id: 'f1', title: 'Quote' },
      { id: 'f2', title: 'Memo' },
    ])
    const onPackLinked = vi.fn()
    await render(
      createElement(DeskDrawer, {
        practiceId: 'legal',
        packId: 'p1',
        orgId: null,
        vi: false,
        onManage: vi.fn(),
        onPackLinked,
      }),
    )
    await act(async () => button('Quote')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(readForms('legal')).toEqual([
      { id: 'f1', title: 'Quote', linkedProjectId: 'p1' },
      { id: 'f2', title: 'Memo' },
    ])
    expect(onPackLinked).toHaveBeenCalledTimes(1)
  })

  it('never locks a form chip (spec 5.1): with no pack at all it drafts a plain document', async () => {
    writeForms('legal', [{ id: 'f1', title: 'Quote' }])
    await render(
      createElement(DeskDrawer, {
        practiceId: 'legal',
        packId: null,
        orgId: null,
        vi: false,
        onManage: vi.fn(),
      }),
    )
    expect(button('Quote')!.disabled).toBe(false)
    expect(host.querySelector('.wb-forms-locked')).toBeNull()
    // no default project to fall back on: the chip does not promise one
    expect(host.querySelector('.wb-desk-pack .wb-crumb-name')?.textContent).toBe('No pack selected')
    await act(async () => button('Quote')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.newDoc).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined }))
    expect(readForms('legal')[0]!.linkedProjectId).toBeUndefined()
  })

  it('a long form name ends in an ellipsis; the chip title keeps it whole', async () => {
    const long = 'Proposal to approve the 2027 office equipment purchase plan for every branch'
    writeForms('legal', [{ id: 'f1', title: long, note: 'Admin' }])
    await render(
      createElement(DeskDrawer, {
        practiceId: 'legal',
        packId: 'p1',
        orgId: null,
        vi: false,
        onManage: vi.fn(),
      }),
    )
    const chip = button(long)!
    expect(chip.querySelector('.wb-desk-chip-text')?.textContent).toBe(long)
    expect(chip.title).toBe(`${long} — Admin`)
  })

  it('a draft that fails shows an alert toast with Retry', async () => {
    writeForms('legal', [{ id: 'f1', title: 'Quote' }])
    api.newDoc.mockRejectedValueOnce(new Error('no space'))
    await render(
      createElement(
        WbToastHost,
        { toasts: createWbToasts() },
        createElement(DeskDrawer, {
          practiceId: 'legal',
          packId: 'p1',
          orgId: null,
          vi: false,
          onManage: vi.fn(),
        }),
      ),
    )
    await act(async () => button('Quote')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    const toast = host.querySelector('.wb-toast[role="alert"]')!
    expect(toast.textContent).toContain('Couldn’t draft from “Quote”. no space')
    await act(async () =>
      Array.from(toast.querySelectorAll('button'))
        .find((b) => b.textContent === 'Retry')!
        .click(),
    )
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.newDoc).toHaveBeenCalledTimes(2)
    expect(readForms('legal')[0]!.linkedProjectId).toBe('p1')
  })

  it('shows the target pack chip, picks another pack, and adds a form from the ghost button', async () => {
    writeForms('legal', [{ id: 'f1', title: 'Quote' }])
    const onSelectPack = vi.fn()
    const onManage = vi.fn()
    const props = {
      practiceId: 'legal' as const,
      packId: 'p0',
      orgId: null,
      vi: false,
      onManage,
      packs: [{ id: 'p1', title: 'Launch' }],
      onSelectPack,
    }
    await render(createElement(DeskDrawer, { ...props, selectedPackId: null }))
    expect(host.querySelector('.wb-desk-pack')!.textContent).toContain('Default project')
    const select = host.querySelector<HTMLSelectElement>('.wb-desk-pack select')!
    await act(async () => {
      select.value = 'p1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onSelectPack).toHaveBeenCalledWith('p1')
    await render(createElement(DeskDrawer, { ...props, selectedPackId: 'p1' }))
    expect(host.querySelector('.wb-desk-pack')!.textContent).toContain('Launch')
    const add = button('Add a form')!
    expect(add.className).toContain('wb-btn-ghost')
    await act(async () => add.click())
    expect(onManage).toHaveBeenCalled()
    expect(button('Quote')!.className).toContain('wb-btn-secondary')
  })
})
