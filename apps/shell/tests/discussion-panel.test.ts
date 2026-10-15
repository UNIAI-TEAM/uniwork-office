/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, UniworkDocStatus } from '../src/shared/home-api'
import type { TabSummary } from '../src/shared/tabs-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { TabBar } from '../src/renderer/src/TabBar'
import { DiscussionPanel } from '../src/renderer/src/DiscussionPanel'
import { setDiscussionOpen } from '../src/renderer/src/discussion-panel-model'

/**
 * G8-11 (UNI-1406): the shell's Discussion panel (S13) for every editor tab. The panel is shell
 * DOM next to the tab strip; the data comes from `window.uniworkDiscussion` (W11A's bridge, faked
 * here), the document from the active tab's UniWork status. A plain local file shows neither the
 * toggle nor the panel.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const PATH_A = '/home/u/uniwork-documents/d1/Plan.docx'
const PATH_B = '/home/u/uniwork-documents/d2/Budget.xlsx'
const PATH_LOCAL = '/home/u/notes/todo.md'

const POSTS: Record<string, unknown[]> = {
  [PATH_A]: [
    {
      id: 'p1',
      document_id: 'd1',
      author_id: 'u2',
      body: 'Hello team',
      kind: 'discussion',
      created_at: '2026-10-12T09:00:00Z',
      display_name: 'Mai Nguyen',
    },
  ],
  [PATH_B]: [
    {
      id: 'q1',
      document_id: 'd2',
      author_id: 'u3',
      body: 'Second doc post',
      kind: 'discussion',
      created_at: '2026-10-12T10:00:00Z',
      display_name: 'Minh Tran',
    },
  ],
}

function status(path: string, partial: Partial<UniworkDocStatus> = {}): UniworkDocStatus {
  const second = path === PATH_B
  return {
    path,
    documentId: second ? 'd2' : 'd1',
    workspaceId: 'w1',
    title: second ? 'Budget' : 'Plan',
    format: second ? 'xlsx' : 'docx',
    access: 'edit',
    state: 'saved',
    ...partial,
  }
}

const ok = <T>(value: T) => ({ ok: true as const, value })

let host: HTMLDivElement
let root: Root
let tabs: TabSummary[]
let tabListeners: Set<(next: TabSummary[]) => void>
let statuses: Map<string, UniworkDocStatus | null>
let accountState: 'signed-in' | 'signed-out'
let revealHandlers: Map<string, (commentId: string) => void>
let listGate: Promise<void> | null
let bridge: ReturnType<typeof makeBridge>

function makeBridge() {
  return {
    list: vi.fn(async (input: { path: string; sinceToken?: string }) => {
      if (listGate) await listGate
      return ok({
        comments: POSTS[input.path] ?? [],
        mentions: [],
        list_token: 't1',
        unchanged: false,
      })
    }),
    create: vi.fn(async () => ok({ comment: POSTS[PATH_A][0] })),
    update: vi.fn(async () => ok({ comment: POSTS[PATH_A][0] })),
    remove: vi.fn(async () => ok({ outcome: 'removed' as const })),
    resolve: vi.fn(async () => ok({ comment: POSTS[PATH_A][0] })),
    reopen: vi.fn(async () => ok({ comment: POSTS[PATH_A][0] })),
    revisions: vi.fn(async () => ok({ revisions: [] })),
    searchMentions: vi.fn(async () => ok({ candidates: [] })),
    onReveal: vi.fn((path: string, handler: (commentId: string) => void) => {
      revealHandlers.set(path, handler)
      return () => {
        if (revealHandlers.get(path) === handler) revealHandlers.delete(path)
      }
    }),
    setPanel: vi.fn(),
  }
}

function installWindow(): void {
  const win = window as unknown as Record<string, unknown>
  win.aiOfficeTabs = {
    list: vi.fn(async () => tabs),
    onChanged: vi.fn((cb: (next: TabSummary[]) => void) => {
      tabListeners.add(cb)
      return () => {
        tabListeners.delete(cb)
      }
    }),
    activate: vi.fn(async () => undefined),
  }
  win.aiOffice = {
    uniworkDocStatus: vi.fn(async (path: string) => statuses.get(path) ?? null),
    uniworkActiveDocStatus: vi.fn(async () => {
      const active = tabs.find((tab) => tab.active)
      return (active?.filePath && statuses.get(active.filePath)) || null
    }),
    onUniworkDocStatus: vi.fn(() => () => undefined),
    onUniworkQueuePopover: vi.fn(() => () => undefined),
    onUniworkLaunch: vi.fn(() => () => undefined),
    accountStatus: vi.fn(async () => ({
      loggedIn: accountState === 'signed-in',
      state: accountState,
      profile:
        accountState === 'signed-in'
          ? { accountId: 'u1', email: 'me@example.com', displayName: 'Me' }
          : undefined,
    })),
    onAccountStatus: vi.fn(() => () => undefined),
    onAccountLogin: vi.fn(() => () => undefined),
    setLanguage: vi.fn(async () => undefined),
  } as unknown as HomeApi
  win.uniworkDiscussion = bridge
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement('div', null, createElement(TabBar), createElement(DiscussionPanel)),
      ),
    )
  })
  await flush()
}

async function switchTo(active: 'a' | 'b' | 'local'): Promise<void> {
  tabs = tabs.map((tab) => ({ ...tab, active: tab.id === active }))
  await act(async () => {
    for (const listener of [...tabListeners]) listener(tabs)
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

const toggle = () => host.querySelector<HTMLButtonElement>('#uw-discussion-toggle')
const panel = () => host.querySelector<HTMLElement>('aside.collab-panel')
const frame = () => host.querySelector<HTMLElement>('.uw-discussion')

beforeEach(() => {
  // jsdom has no layout: the tab strip scrolls the active tab into view
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  tabs = [
    { id: 'home', kind: 'home', title: 'Home', closable: false, active: false },
    { id: 'a', kind: 'docs', title: 'Plan', closable: true, active: true, filePath: PATH_A },
    { id: 'b', kind: 'sheets', title: 'Budget', closable: true, active: false, filePath: PATH_B },
    {
      id: 'local',
      kind: 'markdown',
      title: 'todo',
      closable: true,
      active: false,
      filePath: PATH_LOCAL,
    },
  ]
  statuses = new Map([
    [PATH_A, status(PATH_A)],
    [PATH_B, status(PATH_B)],
  ])
  accountState = 'signed-in'
  tabListeners = new Set()
  revealHandlers = new Map()
  listGate = null
  bridge = makeBridge()
  setDiscussionOpen(false)
  installWindow()
})

afterEach(() => {
  vi.useRealTimers()
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as Record<string, unknown>).uniworkDiscussion
})

describe('toggle', () => {
  it('a local file shows no toggle and no panel, and asks the server for nothing', async () => {
    await switchTo('local')
    await mount()
    expect(toggle()).toBeNull()
    expect(frame()).toBeNull()
    expect(bridge.list).not.toHaveBeenCalled()
  })

  it('a UniWork document signed out shows no toggle', async () => {
    accountState = 'signed-out'
    await mount()
    expect(toggle()).toBeNull()
    expect(frame()).toBeNull()
  })

  it('a bound document shows a closed toggle; it points at no panel while none exists (F1)', async () => {
    await mount()
    const button = toggle()!
    expect(button.textContent).toContain('Discussion')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(frame()).toBeNull()
    // aria-controls must never name an element that is not in the DOM
    const controls = button.getAttribute('aria-controls')
    expect(controls === null || document.getElementById(controls) !== null).toBe(true)
  })

  it('the open toggle controls the panel frame', async () => {
    await mount()
    await click(toggle())
    const controls = toggle()!.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    expect(document.getElementById(controls!)).toBe(frame())
  })

  it('the resize separator has its own name, not the toggle label (F2)', async () => {
    await mount()
    await click(toggle())
    const handle = frame()!.querySelector('[role=separator]')!
    const name = handle.getAttribute('aria-label')
    expect(name).toBe('Resize panel')
    expect(name).not.toBe(toggle()!.textContent?.trim())
  })

  it('the toggle stays inside the 40 px tab strip with a 44 px hit area (V-F1)', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/src/discussion.css'), 'utf8')
    const rule = (sel: string, from = 0) => {
      const at = css.indexOf(`${sel} {`, from)
      expect(at, `rule ${sel}`).toBeGreaterThanOrEqual(0)
      return css.slice(at, css.indexOf('}', at))
    }
    const px = (block: string, prop: string) =>
      Number(new RegExp(`(?:^|[\\s;])${prop}:\\s*(-?\\d+)px`).exec(block)?.[1] ?? NaN)
    const base = rule('.uw-discussion-toggle')
    expect(px(base, 'height')).toBeLessThanOrEqual(36)
    expect(base).toMatch(/position:\s*relative/)
    const coarseAt = css.indexOf('@media (pointer: coarse)')
    const coarse = rule('.uw-discussion-toggle', coarseAt)
    expect(coarse).not.toMatch(/min-height:\s*44px/)
    const pill = px(coarse, 'height')
    expect(pill).toBeLessThanOrEqual(36)
    // the 44 px target is a pseudo-element, so the visible pill stays small
    const hit = rule('.uw-discussion-toggle::after')
    expect(hit).toMatch(/position:\s*absolute/)
    const coarseHit = rule('.uw-discussion-toggle::after', coarseAt)
    const reach = (block: string) => pill - px(block, 'top') - px(block, 'bottom')
    expect(reach(coarseHit)).toBeGreaterThanOrEqual(44)
  })

  it('opens the panel, tells main the width and renders the list from the bridge', async () => {
    await mount()
    await click(toggle())
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
    expect(frame()!.id).toBe(toggle()!.getAttribute('aria-controls'))
    expect(panel()).not.toBeNull()
    expect(bridge.list).toHaveBeenCalledWith(expect.objectContaining({ path: PATH_A }))
    expect(panel()!.textContent).toContain('Hello team')
    const open = bridge.setPanel.mock.calls.filter(([i]) => i.open)
    expect(open.length).toBeGreaterThan(0)
    expect(open.at(-1)![0].width).toBeGreaterThanOrEqual(280)
  })
})

describe('width', () => {
  it('draws and reports the width main will take: the editor keeps its minimum', async () => {
    const wide = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 })
    try {
      await mount()
      await click(toggle())
      // 600 - 360 (editor minimum) = 240, below the panel's own minimum: the window decides
      expect(bridge.setPanel).toHaveBeenLastCalledWith({ open: true, width: 240 })
      expect(frame()!.style.getPropertyValue('--uw-discussion-width')).toBe('240px')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: wide })
    }
  })

  // R1-3: `.app-frame` is `zoom: var(--ui-scale)`, so a fixed panel paints `width x scale` CSS px.
  // The width the panel reports to main is in window pixels (what main frees for the editor
  // view); the box divides by the scale so what it paints is exactly what main freed.
  it('paints the reported window-pixel width at any interface scale', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/src/discussion.css'), 'utf8')
    const at = css.indexOf('.uw-discussion {')
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toMatch(
      /width:\s*calc\(var\(--uw-discussion-width\)\s*\/\s*var\(--ui-scale,\s*1\)\)/,
    )
  })
})

describe('active tab', () => {
  it('re-keys on a tab switch: the frame stays, the old list never shows under the new document', async () => {
    await mount()
    await click(toggle())
    const before = frame()
    expect(panel()!.textContent).toContain('Hello team')

    let release: () => void = () => undefined
    listGate = new Promise<void>((resolve) => {
      release = resolve
    })
    await switchTo('b')
    expect(frame()).toBe(before)
    expect(host.textContent).not.toContain('Hello team')
    expect(host.textContent).not.toContain('Second doc post')

    listGate = null
    await act(async () => release())
    await flush()
    expect(host.textContent).toContain('Second doc post')
    expect(bridge.list).toHaveBeenCalledWith(expect.objectContaining({ path: PATH_B }))
    expect(revealHandlers.has(PATH_B)).toBe(true)
    expect(revealHandlers.has(PATH_A)).toBe(false)
  })

  it('closes when the active tab is not a bound document', async () => {
    await mount()
    await click(toggle())
    expect(frame()).not.toBeNull()
    await switchTo('local')
    expect(frame()).toBeNull()
    expect(toggle()).toBeNull()
    expect(bridge.setPanel.mock.calls.at(-1)![0].open).toBe(false)
  })
})

describe('reveal', () => {
  it('opens the panel for a discussion post and focuses its thread', async () => {
    await mount()
    expect(frame()).toBeNull()
    await act(async () => revealHandlers.get(PATH_A)!('p1'))
    await flush()
    await flush()
    expect(frame()).not.toBeNull()
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
    const thread = panel()!.querySelector('[data-thread-id="p1"]')!
    expect(thread.contains(document.activeElement)).toBe(true)
  })

  it('an id that is not a discussion post leaves the panel closed, with no message', async () => {
    await mount()
    const before = host.textContent
    await act(async () => revealHandlers.get(PATH_A)!('c-anchored-comment'))
    await flush()
    await flush()
    expect(frame()).toBeNull()
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).toBe(before)
    expect(bridge.setPanel.mock.calls.some(([i]) => i.open)).toBe(false)
  })
})

describe('keyboard', () => {
  it('Esc inside the panel closes it and returns focus to the toggle', async () => {
    await mount()
    await click(toggle())
    const inside = panel()!.querySelector<HTMLElement>('[data-thread-heading]')!
    expect(inside).toBeTruthy()
    await act(async () => inside.focus())
    await act(async () => {
      inside.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    await flush()
    expect(frame()).toBeNull()
    expect(document.activeElement).toBe(toggle())
    expect(bridge.setPanel.mock.calls.at(-1)![0].open).toBe(false)
  })

  it('Esc in an empty composer closes the panel and returns focus to the toggle (V-F3)', async () => {
    await mount()
    await click(toggle())
    const area = panel()!.querySelector<HTMLTextAreaElement>('textarea')!
    expect(area).toBeTruthy()
    await act(async () => area.focus())
    await act(async () => {
      area.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    await flush()
    expect(frame()).toBeNull()
    expect(document.activeElement).toBe(toggle())
  })

  it('Esc with text in the composer keeps the panel open (the kit asks first)', async () => {
    await mount()
    await click(toggle())
    const area = panel()!.querySelector<HTMLTextAreaElement>('textarea')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      area.focus()
      setValue.call(area, 'half a thought')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      area.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    await flush()
    expect(frame()).not.toBeNull()
  })

  it('the toggle closes the panel again', async () => {
    await mount()
    await click(toggle())
    await click(toggle())
    expect(frame()).toBeNull()
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('refresh', () => {
  it('polls every 30 s while open and stops when closed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await mount()
    await click(toggle())
    const before = bridge.list.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(bridge.list.mock.calls.length).toBeGreaterThan(before)
    expect(bridge.list.mock.calls.at(-1)![0].sinceToken).toBe('t1')
    await click(toggle())
    const closed = bridge.list.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000)
    })
    expect(bridge.list.mock.calls.length).toBe(closed)
  })
})
