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
    // a person's comment: their initials and an info pill; the date is not mono
    expect(host.querySelector('.wb-desk-avatar')!.textContent).toBe('L')
    expect(host.querySelector('.wb-pill.is-info')!.textContent).toBe('Comment')
    expect(host.querySelector('.wb-desk-when')!.className).not.toContain('wb-mono')
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
    await act(async () => host.querySelector<HTMLButtonElement>('li .wb-link')!.click())
    expect(titles()).toHaveLength(9)
    expect(document.activeElement).toBe(titles()[8])
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

  it('locks a form chip when there is no pack to draft into', async () => {
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
    expect(button('Quote')!.disabled).toBe(true)
    expect(host.querySelector('.wb-forms-locked')?.textContent).toBeTruthy()
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
