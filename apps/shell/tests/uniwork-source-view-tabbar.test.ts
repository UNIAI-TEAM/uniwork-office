/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, UniworkDocStatus } from '../src/shared/home-api'
import type { SourceViewState } from '../src/shared/source-view'
import type { TabSummary } from '../src/shared/tabs-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { TabBar } from '../src/renderer/src/TabBar'

/**
 * UNI-1993 (contract 3.3, fe-8 items 1 and 2, test 7): the tab strip shows the "View only · From
 * ..." chip for a path the shell registered as a source view (asked through
 * `uniworkSourceViewState(path)` when a tab's path appears, dropped when it answers null), shows
 * the Save hint for the tab that owns the path, and offers a source tab none of the UniWork
 * document entries (status pill, Discussion) nor the inline rename (the shell keys the
 * view-only registry by the path: a renamed file would read as a plain one).
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const SRC = '/home/u/.config/app/uniwork-drafts-preview/sources-s1/ab12/Plan.docx'
const SRC2 = '/home/u/.config/app/uniwork-drafts-preview/sources-s1/cd34/Budget.xlsx'
const DOC = '/home/u/uniwork-documents/d1/Notes.docx'
const LOCAL = '/home/u/notes/todo.md'

const STATES: Record<string, SourceViewState | null> = {
  [SRC]: { name: 'Plan.docx', origin: 'task', parentTitle: 'Fix login' },
  [SRC2]: { name: 'Budget.xlsx', origin: 'doc', parentTitle: '' },
}

let host: HTMLDivElement
let root: Root
let tabs: TabSummary[]
let tabListeners: Set<(next: TabSummary[]) => void>
let hintListeners: Set<(payload: { path: string }) => void>
let unsubscribed: number
let states: Record<string, SourceViewState | null>
let api: Record<string, ReturnType<typeof vi.fn>>

const docStatus: UniworkDocStatus = {
  path: DOC,
  documentId: 'd1',
  workspaceId: 'w1',
  title: 'Notes',
  format: 'docx',
  access: 'edit',
  state: 'saved',
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
  api = {
    uniworkDocStatus: vi.fn(async (path: string) => (path === DOC ? docStatus : null)),
    uniworkActiveDocStatus: vi.fn(async () => {
      const active = tabs.find((tab) => tab.active)
      return active?.filePath === DOC ? docStatus : null
    }),
    onUniworkDocStatus: vi.fn(() => () => undefined),
    onUniworkQueuePopover: vi.fn(() => () => undefined),
    onUniworkLaunch: vi.fn(() => () => undefined),
    uniworkSourceViewState: vi.fn(async (path: string) => states[path] ?? null),
    onUniworkSourceViewHint: vi.fn((cb: (payload: { path: string }) => void) => {
      hintListeners.add(cb)
      return () => {
        unsubscribed++
        hintListeners.delete(cb)
      }
    }),
    accountStatus: vi.fn(async () => ({ loggedIn: true, state: 'signed-in' as const })),
    onAccountStatus: vi.fn(() => () => undefined),
    onAccountLogin: vi.fn(() => () => undefined),
    setLanguage: vi.fn(async () => undefined),
    renameFile: vi.fn(async () => undefined),
  }
  win.aiOffice = api as unknown as HomeApi
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })
}

async function mount(lang: 'en' | 'vi' = 'en'): Promise<void> {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: lang }, createElement(TabBar)))
  })
  await flush()
}

async function setTabs(next: TabSummary[]): Promise<void> {
  tabs = next
  await act(async () => {
    for (const listener of [...tabListeners]) listener(tabs)
  })
  await flush()
}

const tabsOf = (activeId: string): TabSummary[] => [
  { id: 'home', kind: 'home', title: 'Home', closable: false, active: activeId === 'home' },
  {
    id: 'src',
    kind: 'docs',
    title: 'Plan.docx',
    closable: true,
    active: activeId === 'src',
    filePath: SRC,
  },
  {
    id: 'src2',
    kind: 'sheets',
    title: 'Budget.xlsx',
    closable: true,
    active: activeId === 'src2',
    filePath: SRC2,
  },
  {
    id: 'doc',
    kind: 'docs',
    title: 'Notes',
    closable: true,
    active: activeId === 'doc',
    filePath: DOC,
  },
  {
    id: 'local',
    kind: 'markdown',
    title: 'todo',
    closable: true,
    active: activeId === 'local',
    filePath: LOCAL,
  },
]

const chip = () => host.querySelector<HTMLElement>('.uw-chrome .uw-pill[data-state="view-only"]')
const statusPill = () =>
  host.querySelector('.uw-chrome .uw-pill[role="group"]:not([data-state="view-only"])')
const hint = () => document.querySelector<HTMLElement>('[data-uw-source-hint]')
async function emitHint(path: string): Promise<void> {
  await act(async () => {
    for (const listener of [...hintListeners]) listener({ path })
  })
  await flush()
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  tabListeners = new Set()
  hintListeners = new Set()
  unsubscribed = 0
  states = { ...STATES }
  tabs = tabsOf('src')
  installWindow()
})

afterEach(() => {
  vi.useRealTimers()
  act(() => root.unmount())
  host.remove()
})

describe('the source view chip in the tab strip', () => {
  it('shows "View only · From Tasks · title" for the active source tab and asks the shell for its path', async () => {
    await mount()
    expect(api.uniworkSourceViewState).toHaveBeenCalledWith(SRC)
    expect(chip()?.querySelector('.uw-pill-label')?.textContent).toBe('View only · From Tasks')
    expect(chip()?.getAttribute('title')).toContain('Tasks · Fix login')
  })

  it('speaks vi', async () => {
    await mount('vi')
    expect(chip()?.querySelector('.uw-pill-label')?.textContent).toBe('Chỉ xem · Từ Công việc')
  })

  it('follows the active tab: another source, a UniWork document, a local file', async () => {
    await mount()
    await setTabs(tabsOf('src2'))
    // an origin this build has no name for: the generic chip
    expect(chip()?.querySelector('.uw-pill-label')?.textContent).toBe('View only')
    await setTabs(tabsOf('doc'))
    expect(chip()).toBeNull()
    await setTabs(tabsOf('local'))
    expect(chip()).toBeNull()
    await setTabs(tabsOf('src'))
    expect(chip()?.querySelector('.uw-pill-label')?.textContent).toBe('View only · From Tasks')
  })

  it('asks once per path, for every tab, and not again when only the active tab changes', async () => {
    await mount()
    const asked = api.uniworkSourceViewState.mock.calls.map((c) => c[0] as string).sort()
    expect(asked).toEqual([DOC, LOCAL, SRC, SRC2].sort())
    api.uniworkSourceViewState.mockClear()
    await setTabs(tabsOf('src2'))
    expect(api.uniworkSourceViewState).not.toHaveBeenCalled()
  })

  it('drops the chip when the shell answers null for the path (the view was closed)', async () => {
    await mount()
    expect(chip()).not.toBeNull()
    // the same tab now holds another path: asked again, null, no chip
    states[LOCAL] = null
    await setTabs(tabs.map((tab) => (tab.id === 'src' ? { ...tab, filePath: LOCAL } : tab)))
    expect(api.uniworkSourceViewState).toHaveBeenCalledWith(LOCAL)
    expect(chip()).toBeNull()
  })

  it('a bridge that rejects or answers nothing leaves no chip and no error', async () => {
    api.uniworkSourceViewState.mockRejectedValue(new Error('ipc'))
    await mount()
    expect(chip()).toBeNull()
    delete (window.aiOffice as unknown as Record<string, unknown>).uniworkSourceViewState
    await setTabs(tabsOf('doc'))
    expect(chip()).toBeNull()
  })

  it('a source tab has no UniWork status pill and no Discussion toggle', async () => {
    await mount()
    expect(statusPill()).toBeNull()
    expect(host.querySelector('#uw-discussion-toggle')).toBeNull()
    // the UniWork document next to it still has its own
    await setTabs(tabsOf('doc'))
    expect(host.querySelector('.uw-chrome .uw-pill[role="group"]')).not.toBeNull()
  })

  it('a source tab cannot be renamed inline; a local file still can', async () => {
    await mount()
    const mousedown = (title: string) => {
      const tab = host.querySelector<HTMLElement>(`.tab-item[title="${title}"]`)!
      return act(async () => {
        tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 2 }))
      })
    }
    await mousedown('Plan.docx')
    expect(host.querySelector('.tab-rename-input')).toBeNull()
    await mousedown('todo')
    expect(host.querySelector('.tab-rename-input')).not.toBeNull()
  })
})

describe('the Save hint of a source tab', () => {
  it('shows the sentence for the active tab that owns the path, as a status (focus stays in the editor)', async () => {
    await mount()
    expect(hint()).toBeNull()
    await emitHint(SRC)
    expect(hint()?.textContent).toContain("This file is view only — changes aren't saved.")
    expect(hint()?.querySelector('[role="status"]')).not.toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('speaks vi', async () => {
    await mount('vi')
    await emitHint(SRC)
    expect(hint()?.textContent).toContain('Tệp này chỉ để xem — thay đổi không được lưu.')
  })

  it('ignores a path that is not the active source tab', async () => {
    await mount()
    await emitHint(SRC2)
    expect(hint()).toBeNull()
    await emitHint(LOCAL)
    expect(hint()).toBeNull()
  })

  it('goes away on Escape, on the next tab change and by itself after a few seconds', async () => {
    await mount()
    await emitHint(SRC)
    expect(hint()).not.toBeNull()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(hint()).toBeNull()

    await emitHint(SRC)
    await setTabs(tabsOf('src2'))
    expect(hint()).toBeNull()

    await setTabs(tabsOf('src'))
    vi.useFakeTimers()
    await emitHint(SRC)
    expect(hint()).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(hint()).toBeNull()
  })

  it('a second Ctrl+S keeps one hint and restarts its time', async () => {
    await mount()
    await emitHint(SRC)
    await emitHint(SRC)
    expect(document.querySelectorAll('[data-uw-source-hint]')).toHaveLength(1)
  })

  it('subscribes once and unsubscribes when the tab bar goes away', async () => {
    await mount()
    expect(api.onUniworkSourceViewHint).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
    expect(unsubscribed).toBe(1)
    root = createRoot(host)
  })
})
