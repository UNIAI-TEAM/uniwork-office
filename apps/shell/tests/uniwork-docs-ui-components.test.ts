/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountState,
  HomeApi,
  UniworkDocErrorCode,
  UniworkDocListPage,
  UniworkDocStatus,
  UniworkDocSummary,
  UniworkLaunchEvent,
  UniworkResult,
} from '../src/shared/home-api'
import type { TabSummary } from '../src/shared/tabs-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkOpenCard } from '../src/renderer/src/UniworkOpenCard'
import {
  UniworkNotice,
  UniworkStatusChip,
  useUniworkStatuses,
} from '../src/renderer/src/UniworkChrome'
import { onUniworkNotice, publishUniworkNotice } from '../src/renderer/src/uniwork-notice-bus'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WORKSPACES = [
  { id: 'w1', name: 'Team', orgId: 'o1' },
  { id: 'w2', name: 'Sales', orgId: 'o1' },
]

function doc(id: string, title: string, format: UniworkDocSummary['format']): UniworkDocSummary {
  return { id, workspaceId: 'w1', title, format, updatedAt: '2026-04-02T09:30:00' }
}

function page(
  docs: UniworkDocSummary[],
  nextCursor: string | null = null,
): UniworkResult<UniworkDocListPage> {
  return { ok: true, value: { documents: docs, nextCursor } }
}

function status(partial: Partial<UniworkDocStatus> = {}): UniworkDocStatus {
  return {
    path: 'C:\\ud\\uniwork-documents\\d1\\Plan.docx',
    documentId: 'd1',
    workspaceId: 'w1',
    title: 'Plan',
    format: 'docx',
    access: 'edit',
    state: 'saved',
    ...partial,
  }
}

let host: HTMLDivElement
let root: Root
let account: AccountState
let pushDoc: ((s: UniworkDocStatus) => void) | null
let pushLaunch: ((e: UniworkLaunchEvent) => void) | null

function makeApi() {
  const fns = {
    accountStatus: vi.fn(async () => ({
      loggedIn: account === 'signed-in',
      state: account,
    })),
    onAccountStatus: vi.fn(() => () => undefined),
    onAccountLogin: vi.fn(() => () => undefined),
    accountLogin: vi.fn(async () => true),
    uniworkListWorkspaces: vi.fn(async (): Promise<UniworkResult<typeof WORKSPACES>> => ({
      ok: true,
      value: WORKSPACES,
    })),
    uniworkListDocuments: vi.fn(async (): Promise<UniworkResult<UniworkDocListPage>> =>
      page([
        doc('a', 'Photo.png', null),
        doc('b', 'Plan.docx', 'docx'),
        doc('c', 'Sheet.xlsx', 'xlsx'),
      ]),
    ),
    uniworkOpenDocument: vi.fn(async (): Promise<UniworkResult<{ path: string }>> => ({
      ok: true,
      value: { path: 'C:\\x' },
    })),
    uniworkDocStatus: vi.fn(async (): Promise<UniworkDocStatus | null> => null),
    uniworkActiveDocStatus: vi.fn(async (): Promise<UniworkDocStatus | null> => null),
    onUniworkDocStatus: vi.fn((cb: (s: UniworkDocStatus) => void) => {
      pushDoc = cb
      return () => {
        pushDoc = null
      }
    }),
    uniworkSave: vi.fn(async (): Promise<UniworkDocStatus | null> => null),
    uniworkResolveConflict: vi.fn(async (): Promise<UniworkDocStatus | null> => null),
    onUniworkLaunch: vi.fn((cb: (e: UniworkLaunchEvent) => void) => {
      pushLaunch = cb
      return () => {
        pushLaunch = null
      }
    }),
    setLanguage: vi.fn(async () => undefined),
  }
  window.aiOffice = fns as unknown as HomeApi
  return fns
}

let api: ReturnType<typeof makeApi>

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function mount(
  node: ReturnType<typeof createElement>,
  locale: 'en' | 'vi' = 'en',
): Promise<void> {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: locale }, node))
  })
  await flush()
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function key(el: Element, k: string): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
  await flush()
}

async function type(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')
const search = () => host.querySelector<HTMLInputElement>('.uw-pick-search')!
const rows = () => Array.from(host.querySelectorAll<HTMLElement>('.uw-pick-row'))
const cardButton = () => host.querySelector<HTMLButtonElement>('.uw-open-card')!
const buttonByText = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  account = 'signed-in'
  pushDoc = null
  pushLaunch = null
  api = makeApi()
})

afterEach(() => {
  vi.useRealTimers()
  act(() => root.unmount())
  host.remove()
})

describe('Open from UniWork card', () => {
  it('is visible signed in and opens the picker', async () => {
    await mount(createElement(UniworkOpenCard, { onOpenSettings: vi.fn() }))
    expect(cardButton().textContent).toContain('Open from UniWork')
    expect(dialog()).toBeNull()
    await click(cardButton())
    expect(dialog()).not.toBeNull()
    expect(dialog()!.getAttribute('aria-modal')).toBe('true')
  })

  it('signed out: the card is still there and a click starts the sign-in, not the picker', async () => {
    account = 'signed-out'
    await mount(createElement(UniworkOpenCard, { onOpenSettings: vi.fn() }))
    expect(cardButton().textContent).toContain('Sign in to open')
    await click(cardButton())
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
  })

  it('session expired: asks to sign in again', async () => {
    account = 'session-expired'
    await mount(createElement(UniworkOpenCard, { onOpenSettings: vi.fn() }))
    expect(cardButton().textContent).toContain('Sign in again to open')
    await click(cardButton())
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
  })

  it('not configured: leads to account settings', async () => {
    account = 'not-configured'
    const onOpenSettings = vi.fn()
    await mount(createElement(UniworkOpenCard, { onOpenSettings }))
    expect(cardButton().textContent).toContain('UniWork sign-in is not set up here')
    await click(cardButton())
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(api.accountLogin).not.toHaveBeenCalled()
  })
})

describe('picker dialog', () => {
  const openPicker = async () => {
    await mount(createElement(UniworkOpenCard, { onOpenSettings: vi.fn() }))
    await click(cardButton())
  }

  it('lists the workspace documents; unsupported ones are disabled with a reason', async () => {
    await openPicker()
    expect(api.uniworkListDocuments).toHaveBeenCalledWith({
      workspaceId: 'w1',
      query: undefined,
      limit: 50,
    })
    expect(rows().map((r) => r.querySelector('.uw-pick-row-title')!.textContent)).toEqual([
      'Photo.png',
      'Plan.docx',
      'Sheet.xlsx',
    ])
    expect(rows()[0]!.getAttribute('aria-disabled')).toBe('true')
    expect(rows()[0]!.textContent).toContain('Not supported in UniWork Office')
    expect(rows()[1]!.getAttribute('aria-disabled')).toBe('false')
    expect(rows()[1]!.textContent).toMatch(/Updated/)
    // the highlight starts on the first document that can be opened
    expect(rows()[1]!.getAttribute('aria-selected')).toBe('true')
    expect(search().getAttribute('aria-activedescendant')).toBe(rows()[1]!.id)
  })

  it('arrow keys move over openable rows and Enter opens the highlighted one, then closes', async () => {
    await openPicker()
    await key(search(), 'ArrowDown')
    expect(rows()[2]!.getAttribute('aria-selected')).toBe('true')
    await key(search(), 'ArrowUp')
    expect(rows()[1]!.getAttribute('aria-selected')).toBe('true')
    await key(search(), 'Enter')
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('b')
    expect(dialog()).toBeNull()
  })

  it('tells the rest of the renderer which document it opened, so recents can refresh', async () => {
    const seen: unknown[] = []
    const off = onUniworkNotice((event) => seen.push(event))
    try {
      await openPicker()
      await key(search(), 'Enter')
    } finally {
      off()
    }
    expect(seen).toEqual([
      { phase: 'opened', path: expect.any(String), title: expect.stringContaining('Plan') },
    ])
  })

  it('says nothing about an open that failed', async () => {
    api.uniworkOpenDocument.mockResolvedValueOnce({ ok: false, error: 'network' })
    const seen: unknown[] = []
    const off = onUniworkNotice((event) => seen.push(event))
    try {
      await openPicker()
      await key(search(), 'Enter')
    } finally {
      off()
    }
    expect(seen).toEqual([])
  })

  it('clicking a disabled row opens nothing', async () => {
    await openPicker()
    await click(rows()[0])
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
  })

  it('Escape and the close button close it', async () => {
    await openPicker()
    await key(search(), 'Escape')
    expect(dialog()).toBeNull()
    await click(cardButton())
    await click(host.querySelector('.uw-pick-close'))
    expect(dialog()).toBeNull()
  })

  it('shows progress while opening, and the failure inline with the dialog kept open', async () => {
    let finish: (r: UniworkResult<{ path: string }>) => void = () => undefined
    api.uniworkOpenDocument.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    await openPicker()
    await click(rows()[1])
    expect(host.querySelector('.uw-pick-progress')!.textContent).toContain('Opening “Plan.docx”…')
    await act(async () => finish({ ok: false, error: 'forbidden' }))
    await flush()
    expect(host.querySelector('.uw-pick-progress')).toBeNull()
    expect(host.querySelector('.uw-pick-open-error')!.textContent).toContain(
      'You don’t have permission to do that.',
    )
    expect(dialog()).not.toBeNull()
  })

  it('an expired session while opening offers Sign in', async () => {
    api.uniworkOpenDocument.mockResolvedValueOnce({ ok: false, error: 'session_expired' })
    await openPicker()
    await click(rows()[1])
    const signIn = host.querySelector<HTMLButtonElement>('.uw-pick-open-error button')!
    expect(signIn.textContent).toBe('Sign in')
    await click(signIn)
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
  })

  it('debounces the search, then lists with the query', async () => {
    vi.useFakeTimers()
    await openPicker()
    api.uniworkListDocuments.mockClear()
    api.uniworkListDocuments.mockResolvedValue(page([doc('p', 'Plan 2026.docx', 'docx')]))
    await type(search(), 'plan')
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(api.uniworkListDocuments).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(150)
    })
    await flush()
    expect(api.uniworkListDocuments).toHaveBeenCalledTimes(1)
    expect(api.uniworkListDocuments).toHaveBeenCalledWith({
      workspaceId: 'w1',
      query: 'plan',
      limit: 50,
    })
    expect(host.querySelector('.uw-pick-heading')!.textContent).toBe('Results')
    expect(rows().map((r) => r.querySelector('.uw-pick-row-title')!.textContent)).toEqual([
      'Plan 2026.docx',
    ])
  })

  it('says so when nothing matches, and when the workspace is empty', async () => {
    api.uniworkListDocuments.mockResolvedValue(page([]))
    await openPicker()
    expect(dialog()!.textContent).toContain('No documents in this workspace yet.')
    vi.useFakeTimers()
    await type(search(), 'zzz')
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    await flush()
    expect(dialog()!.textContent).toContain('No documents match “zzz”.')
  })

  it('switching workspace lists that workspace', async () => {
    await openPicker()
    api.uniworkListDocuments.mockClear()
    const select = host.querySelector<HTMLSelectElement>('.uw-pick-ws')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select, 'w2')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkListDocuments).toHaveBeenCalledWith({
      workspaceId: 'w2',
      query: undefined,
      limit: 50,
    })
  })

  it('Load more fetches the next page with the cursor and appends', async () => {
    api.uniworkListDocuments
      .mockResolvedValueOnce(page([doc('a', 'A.docx', 'docx')], 'cur-1'))
      .mockResolvedValueOnce(page([doc('b', 'B.pdf', 'pdf')]))
    await openPicker()
    expect(rows()).toHaveLength(1)
    await click(buttonByText('Load more'))
    expect(api.uniworkListDocuments).toHaveBeenLastCalledWith({
      workspaceId: 'w1',
      query: undefined,
      cursor: 'cur-1',
      limit: 50,
    })
    expect(rows()).toHaveLength(2)
    expect(buttonByText('Load more')).toBeUndefined()
  })

  it.each<[UniworkDocErrorCode, string, string | null]>([
    ['network', 'Can’t reach UniWork. Check your connection and try again.', 'Retry'],
    ['server_error', 'UniWork ran into a problem. Try again in a moment.', 'Retry'],
    ['session_expired', 'Your UniWork sign-in expired. Sign in again.', 'Sign in'],
    ['forbidden', 'You don’t have permission to do that.', null],
  ])('a %s failure reads "%s" with %s', async (error, message, action) => {
    api.uniworkListDocuments.mockResolvedValueOnce({ ok: false, error })
    await openPicker()
    const alert = dialog()!.querySelector('.uw-pick-state')!
    expect(alert.textContent).toContain(message)
    const buttons = Array.from(alert.querySelectorAll('button')).map((b) => b.textContent)
    expect(buttons).toEqual(action ? [action] : [])
    expect(dialog()!.textContent).not.toMatch(/network|server_error|session_expired/)
  })

  it('Retry after a server error loads the list again', async () => {
    api.uniworkListDocuments.mockResolvedValueOnce({ ok: false, error: 'timeout' })
    await openPicker()
    expect(rows()).toHaveLength(0)
    await click(buttonByText('Retry'))
    expect(api.uniworkListDocuments).toHaveBeenCalledTimes(2)
    expect(rows()).toHaveLength(3)
  })

  it('Retry after the workspace list failed loads the workspaces again', async () => {
    api.uniworkListWorkspaces.mockResolvedValueOnce({ ok: false, error: 'network' })
    await openPicker()
    expect(host.querySelector('.uw-pick-ws')).toBeNull()
    await click(buttonByText('Retry'))
    expect(api.uniworkListWorkspaces).toHaveBeenCalledTimes(2)
    expect(rows()).toHaveLength(3)
  })

  it('a rejected IPC call is shown as a network failure, not an unhandled error', async () => {
    api.uniworkListWorkspaces.mockRejectedValueOnce(new Error('ipc'))
    await openPicker()
    expect(dialog()!.textContent).toContain('Can’t reach UniWork.')
  })

  it('points the search box at the list only while the list is on screen', async () => {
    api.uniworkListDocuments.mockImplementationOnce(() => new Promise(() => {}))
    await openPicker()
    // still loading: there is no list element to control yet
    expect(host.querySelector('#uw-pick-list')).toBeNull()
    expect(search().hasAttribute('aria-controls')).toBe(false)
  })

  it('points the search box at the list once it is there', async () => {
    await openPicker()
    const list = host.querySelector('#uw-pick-list')
    expect(list).not.toBeNull()
    expect(search().getAttribute('aria-controls')).toBe('uw-pick-list')
  })

  it('has labelled controls', async () => {
    await openPicker()
    expect(dialog()!.getAttribute('aria-labelledby')).toBe('uw-pick-title')
    expect(host.querySelector('#uw-pick-title')!.textContent).toBe('Open from UniWork')
    expect(host.querySelector('.uw-pick-close')!.getAttribute('aria-label')).toBe('Close')
    expect(search().getAttribute('aria-label')).toBe('Search documents')
    expect(host.querySelector('.uw-pick-ws')!.getAttribute('aria-label')).toBe('Workspace')
    expect(host.querySelector('[role="listbox"]')!.getAttribute('aria-label')).toBe('Documents')
  })
})

describe('status chip', () => {
  const chip = () => host.querySelector<HTMLElement>('.uw-pill')!

  it('shows the label and runs Retry through uniworkSave for that path', async () => {
    const s = status({ state: 'offline' })
    const onStatus = vi.fn()
    api.uniworkSave.mockResolvedValueOnce(status({ state: 'saved' }))
    account = 'signed-in'
    await mount(createElement(UniworkStatusChip, { status: s, onStatus }))
    expect(chip().textContent).toContain('Not saved: offline')
    await click(buttonByText('Retry'))
    expect(api.uniworkSave).toHaveBeenCalledWith(s.path)
    expect(onStatus).toHaveBeenCalledWith(status({ state: 'saved' }))
  })

  it('conflict: Resolve… opens the native choice for that path', async () => {
    const s = status({ state: 'conflict' })
    await mount(createElement(UniworkStatusChip, { status: s, onStatus: vi.fn() }))
    await click(buttonByText('Resolve…'))
    expect(api.uniworkResolveConflict).toHaveBeenCalledWith(s.path)
    expect(api.uniworkSave).not.toHaveBeenCalled()
  })

  it('signed out: Sign in starts the account sign-in, not a save', async () => {
    account = 'session-expired'
    await mount(
      createElement(UniworkStatusChip, {
        status: status({ state: 'signed-out' }),
        onStatus: vi.fn(),
      }),
    )
    expect(chip().textContent).toContain('Sign in again to save')
    await click(buttonByText('Sign in'))
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
    expect(api.uniworkSave).not.toHaveBeenCalled()
  })

  it('signed out document with the account signed in again: Retry', async () => {
    account = 'signed-in'
    await mount(
      createElement(UniworkStatusChip, {
        status: status({ state: 'signed-out' }),
        onStatus: vi.fn(),
      }),
    )
    expect(buttonByText('Retry')).toBeTruthy()
    expect(buttonByText('Sign in')).toBeUndefined()
  })

  it('View only and Saved have no button; Blocked names the reason', async () => {
    await mount(
      createElement(UniworkStatusChip, { status: status({ access: 'view' }), onStatus: vi.fn() }),
    )
    expect(chip().textContent).toBe('View only')
    expect(chip().querySelector('button')).toBeNull()
    await mount(
      createElement(UniworkStatusChip, {
        status: status({ state: 'blocked', error: 'quota_exceeded' }),
        onStatus: vi.fn(),
      }),
    )
    expect(chip().textContent).toBe('Blocked: storage full')
    expect(chip().getAttribute('title')).toContain('Your UniWork storage is full.')
  })

  it('is a labelled group, so a screen reader knows what the status belongs to', async () => {
    await mount(
      createElement(UniworkStatusChip, { status: status({ state: 'dirty' }), onStatus: vi.fn() }),
    )
    expect(chip().getAttribute('role')).toBe('group')
    expect(chip().getAttribute('aria-label')).toBe('UniWork save status')
  })

  it('announces its text as a status region', async () => {
    await mount(
      createElement(UniworkStatusChip, { status: status({ state: 'saving' }), onStatus: vi.fn() }),
    )
    expect(chip().querySelector('[role="status"]')!.textContent).toBe('Saving…')
  })
})

describe('chip truncation and hover text', () => {
  const pillOf = () => host.querySelector<HTMLElement>('.uw-pill')!
  const labelOf = () => pillOf().querySelector<HTMLElement>('.uw-pill-label')!

  const STATES: Array<[string, Partial<UniworkDocStatus>]> = [
    ['saved', { state: 'saved' }],
    ['ready', { state: 'ready' }],
    ['unsaved', { state: 'dirty' }],
    ['saving', { state: 'saving' }],
    ['view only', { access: 'view' }],
    ['offline', { state: 'offline', error: 'network' }],
    ["can't reach UniWork", { state: 'offline', error: 'server_error' }],
    ['sign in again', { state: 'signed-out' }],
    ['conflict', { state: 'conflict' }],
    ['blocked', { state: 'blocked', error: 'quota_exceeded' }],
    ['error', { state: 'error', error: 'server_error' }],
  ]

  for (const locale of ['en', 'vi'] as const) {
    for (const [name, partial] of STATES) {
      it(`${locale}: ${name} shows its label, truncates it, and carries the full text as title`, async () => {
        account = 'session-expired'
        await mount(
          createElement(UniworkStatusChip, { status: status(partial), onStatus: vi.fn() }),
          locale,
        )
        const label = labelOf()
        expect(label.textContent!.trim().length).toBeGreaterThan(0)
        expect(label.classList.contains('uw-pill-label')).toBe(true)
        // the full label leads the hover text, followed by the explanation
        const title = pillOf().getAttribute('title')!
        expect(title.startsWith(`${label.textContent}\n`)).toBe(true)
        expect(title.length).toBeGreaterThan(label.textContent!.length + 1)
        // the label is the only thing that gives way, never a button
        for (const button of pillOf().querySelectorAll('button')) {
          expect(button.closest('.uw-pill-status')).toBeNull()
        }
      })
    }
  }

  it('launch notices carry their full message as title and truncate the label', async () => {
    await mount(createElement(UniworkNotice))
    for (const event of [
      { phase: 'opening', title: 'A very long quarterly planning document name.docx' },
      { phase: 'needs-sign-in' },
      { phase: 'failed', error: 'ticket_expired' },
    ] as UniworkLaunchEvent[]) {
      await act(async () => pushLaunch!(event))
      const pill = host.querySelector<HTMLElement>('.uw-notice')!
      const label = pill.querySelector<HTMLElement>('.uw-pill-label')!
      expect(pill.getAttribute('title')).toBe(label.textContent)
    }
  })

  it('the stylesheet lets only the label shrink, with an ellipsis, and pads the pill evenly', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/src/tabbar.css'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    const body = (selector: string): string => {
      const start = css.indexOf(`\n${selector} {`)
      expect(start, selector).toBeGreaterThanOrEqual(0)
      return css.slice(start, css.indexOf('}', start))
    }
    const label = body('.uw-pill-label')
    expect(label).toMatch(/min-width: 0/)
    expect(label).toMatch(/overflow: hidden/)
    expect(label).toMatch(/text-overflow: ellipsis/)
    expect(label).toMatch(/white-space: nowrap/)
    const pill = body('.uw-pill')
    expect(pill).toMatch(/padding: 0 \d+px;/)
    expect(pill).not.toMatch(/overflow: hidden/)
    expect(body('.uw-pill-status')).toMatch(/min-width: 0/)
    // buttons never get squeezed off
    expect(css).toMatch(/\.uw-pill-action,\n\.uw-pill-close \{[^}]*flex: 0 0 auto/)
  })

  it('the chrome holder takes the width the pill needs before the tab strip gives any up', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/src/tabbar.css'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    const start = css.indexOf('\n.uw-chrome {')
    expect(start).toBeGreaterThanOrEqual(0)
    const chrome = css.slice(start, css.indexOf('}', start))
    expect(chrome).toMatch(/flex: 0 0 auto/)
    expect(chrome).toMatch(/max-width: 55%/)
  })
})

describe('Home quick cards fit', () => {
  const css = readFileSync(resolve(__dirname, '../src/renderer/src/home.css'), 'utf8').replace(
    /\r\n/g,
    '\n',
  )
  const body = (selector: string): string => {
    const start = css.indexOf(`\n${selector} {`)
    expect(start, selector).toBeGreaterThanOrEqual(0)
    return css.slice(start, css.indexOf('}', start))
  }

  it('lays the eight cards out as two rows of four, two columns below 1100px', () => {
    expect(body('.quick-cards')).toMatch(/display: grid/)
    expect(body('.quick-cards')).toMatch(/grid-template-columns: repeat\(4, minmax\(0, 280px\)\)/)
    expect(css).toMatch(
      /@media \(max-width: 1100px\) \{\n {2}\.quick-cards \{\n {4}grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    )
  })

  it('a card title wraps instead of being clipped', () => {
    const title = body('.quick-title')
    expect(title).toMatch(/overflow-wrap: anywhere/)
    expect(title).not.toMatch(/white-space: nowrap/)
    expect(title).not.toMatch(/text-overflow/)
    expect(title).not.toMatch(/overflow: hidden/)
  })

  it('a subtitle clamps to two lines and the card carries it in the tooltip', async () => {
    const sub = body('.quick-sub')
    expect(sub).toMatch(/-webkit-line-clamp: 2/)
    expect(sub).not.toMatch(/white-space: nowrap/)
    await mount(createElement(UniworkOpenCard, { onOpenSettings: vi.fn() }), 'vi')
    const subtitle = cardButton().querySelector<HTMLElement>('.quick-sub')!
    expect(subtitle.textContent).toBeTruthy()
    expect(subtitle.getAttribute('title')).toBe(subtitle.textContent)
  })
})

describe('useUniworkStatuses', () => {
  function Probe({ tabs }: { tabs: TabSummary[] }) {
    const statuses = useUniworkStatuses(tabs)
    return createElement(
      'ul',
      null,
      tabs.map((tab) =>
        createElement(
          'li',
          { key: tab.id, 'data-id': tab.id },
          statuses.statusOf(tab.filePath)?.state ?? 'none',
        ),
      ),
    )
  }
  const tab = (id: string, filePath?: string, active = false): TabSummary => ({
    id,
    kind: 'docs',
    title: id,
    closable: true,
    active,
    filePath,
  })
  const text = (id: string) => host.querySelector(`[data-id="${id}"]`)!.textContent

  it('reads each tab path once; local files stay unbound', async () => {
    api.uniworkDocStatus.mockImplementation(async (p: string) =>
      p.includes('uniwork-documents') ? status({ path: p, state: 'dirty' }) : null,
    )
    const tabs = [
      tab('t1', 'C:\\ud\\uniwork-documents\\d1\\Plan.docx'),
      tab('t2', 'C:\\docs\\local.docx'),
    ]
    await mount(createElement(Probe, { tabs }))
    expect(text('t1')).toBe('dirty')
    expect(text('t2')).toBe('none')
    expect(api.uniworkDocStatus).toHaveBeenCalledTimes(2)
    // a re-render with the same tabs does not read again
    await mount(createElement(Probe, { tabs: [...tabs] }))
    expect(api.uniworkDocStatus).toHaveBeenCalledTimes(2)
  })

  it('follows pushed changes, matching the path whatever the slash direction', async () => {
    const path = 'C:\\ud\\uniwork-documents\\d1\\Plan.docx'
    api.uniworkDocStatus.mockResolvedValue(status({ path, state: 'saved' }))
    await mount(createElement(Probe, { tabs: [tab('t1', path)] }))
    expect(text('t1')).toBe('saved')
    await act(async () =>
      pushDoc!(status({ path: 'c:/ud/uniwork-documents/d1/Plan.docx', state: 'offline' })),
    )
    expect(text('t1')).toBe('offline')
  })

  it('a push that lands while a read is in flight wins over the older read', async () => {
    const path = 'C:\\ud\\uniwork-documents\\d1\\Plan.docx'
    let answer: (s: UniworkDocStatus | null) => void = () => undefined
    api.uniworkDocStatus.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    await mount(createElement(Probe, { tabs: [tab('t1', path)] }))
    await act(async () => pushDoc!(status({ path, state: 'conflict' })))
    await act(async () => answer(status({ path, state: 'saved' })))
    await flush()
    expect(text('t1')).toBe('conflict')
  })

  it('forgets a closed tab, so a reopened one is read fresh', async () => {
    const path = 'C:\\ud\\uniwork-documents\\d1\\Plan.docx'
    api.uniworkDocStatus.mockResolvedValue(status({ path, state: 'dirty' }))
    await mount(createElement(Probe, { tabs: [tab('t1', path)] }))
    await mount(createElement(Probe, { tabs: [] }))
    api.uniworkDocStatus.mockResolvedValue(status({ path, state: 'saved' }))
    await mount(createElement(Probe, { tabs: [tab('t1', path)] }))
    expect(text('t1')).toBe('saved')
  })

  it('reads the active tab again when the active tab changes', async () => {
    const path = 'C:\\ud\\uniwork-documents\\d1\\Plan.docx'
    await mount(createElement(Probe, { tabs: [tab('t1', path, true)] }))
    expect(api.uniworkActiveDocStatus).toHaveBeenCalledTimes(1)
  })
})

describe('launch notice', () => {
  const pill = () => host.querySelector<HTMLElement>('.uw-notice')

  it('shows nothing until main reports something', async () => {
    await mount(createElement(UniworkNotice))
    expect(pill()).toBeNull()
  })

  it('shows progress, then clears when the document opened', async () => {
    await mount(createElement(UniworkNotice))
    await act(async () => pushLaunch!({ phase: 'opening', title: 'Plan.docx' }))
    expect(pill()!.textContent).toBe('Opening “Plan.docx”…')
    expect(pill()!.querySelector('button')).toBeNull()
    await act(async () => pushLaunch!({ phase: 'opened', path: 'C:\\x', title: 'Plan.docx' }))
    expect(pill()).toBeNull()
  })

  it('asks to sign in and starts the sign-in', async () => {
    account = 'signed-out'
    await mount(createElement(UniworkNotice))
    await act(async () => pushLaunch!({ phase: 'needs-sign-in' }))
    expect(pill()!.textContent).toContain('Sign in to UniWork to open this document.')
    await click(buttonByText('Sign in'))
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
  })

  it('failures read as sentences, can be dismissed, and expire on their own', async () => {
    vi.useFakeTimers()
    await mount(createElement(UniworkNotice))
    await act(async () => pushLaunch!({ phase: 'failed', error: 'ticket_expired' }))
    expect(pill()!.textContent).toContain(
      'This link expired. Open the document again from UniWork.',
    )
    await click(host.querySelector('.uw-pill-close'))
    expect(pill()).toBeNull()
    await act(async () => pushLaunch!({ phase: 'failed', error: 'forbidden' }))
    expect(pill()).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(13_000)
    })
    expect(pill()).toBeNull()
  })

  it('also shows failures the renderer reports itself (a UniWork recent that could not open)', async () => {
    await mount(createElement(UniworkNotice))
    await act(async () => publishUniworkNotice({ phase: 'failed', error: 'not_found' }))
    expect(pill()!.textContent).toContain('This document no longer exists.')
    expect(host.querySelector('.uw-pill-close')!.getAttribute('aria-label')).toBe('Dismiss')
  })
})
