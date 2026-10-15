/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requirePractice } from '@uniwork/practice-core'
import type { HomeApi, UniworkWorkspaceRef } from '../src/shared/home-api'
import type { UniworkWorkApi } from '../src/shared/uniwork-work-api'

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
  id: 'w-forbidden',
  name: 'Ops',
  orgId: 'o1',
  slug: 'ops',
  orgSlug: 'acme',
}
const WS2: UniworkWorkspaceRef = { ...WS, id: 'w-other', name: 'Sales', slug: 'sales' }
let host: HTMLDivElement
let root: Root

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

const forbidden = async () => ({ ok: false, error: 'forbidden' })

beforeEach(() => {
  store.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  window.aiOffice = {
    uniworkListWorkspaces: vi.fn(async () => ({ ok: true, value: [WS, WS2] })),
    accountStatus: vi.fn(async () => ({ loggedIn: true, state: 'signed-in' })),
    recents: vi.fn(async () => ({ entries: [], total: 0, totalAll: 0 })),
    uniworkListDocuments: vi.fn(forbidden),
    uniworkListSharedWithMe: vi.fn(forbidden),
    uniworkDocStatus: vi.fn(async () => null),
    onUniworkDocStatus: vi.fn(() => () => undefined),
    listDrafts: vi.fn(async () => []),
    setLanguage: vi.fn(async () => undefined),
  } as unknown as HomeApi
  window.uniworkWork = {
    homeSummary: vi.fn(forbidden),
    myTasks: vi.fn(forbidden),
    taskStatuses: vi.fn(forbidden),
    myProfile: vi.fn(forbidden),
    calendarEvents: vi.fn(forbidden),
    openWeb: vi.fn(async () => true),
  } as unknown as UniworkWorkApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const workspaceSelect = () => host.querySelector('select[aria-label="Workspace"]')
const buttonsByText = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
    (b) => b.textContent === text,
  )

async function openTab(label: string): Promise<void> {
  const tab = Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-tab-module')).find((b) =>
    b.textContent?.includes(label),
  )
  await act(async () => tab?.click())
  await flush()
}

describe('lost access offers "Choose another workspace" (spec 4.11)', () => {
  it('Desk Today and the tray: the action moves focus to the workspace chip', async () => {
    await renderHome()
    const picks = buttonsByText('Choose another workspace')
    // Today's compact panel, and the tray's line
    expect(picks.length).toBe(2)
    expect(picks.some((b) => b.closest('.wb-state'))).toBe(true)
    expect(picks.some((b) => b.closest('.wb-ov-note'))).toBe(true)
    for (const pick of picks) {
      ;(document.activeElement as HTMLElement | null)?.blur()
      await act(async () => pick.click())
      expect(document.activeElement).toBe(workspaceSelect())
    }
  })

  it('with no other workspace to choose, the action is left out rather than opening the same one', async () => {
    ;(window.aiOffice.uniworkListWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: [WS],
    })
    await renderHome()
    expect(workspaceSelect()).not.toBeNull()
    expect(buttonsByText('Choose another workspace')).toHaveLength(0)
    await openTab('Tasks')
    const panel = host.querySelector('.wb-state[role="alert"]')!
    expect(panel.textContent).toContain('no longer have access')
    expect(panel.querySelectorAll('button')).toHaveLength(0)
  })

  it.each(['Tasks', 'Calendar', 'Profile'])(
    'the %s tab: the panel has no Retry, only the workspace action',
    async (label) => {
      await renderHome()
      await openTab(label)
      const panel = host.querySelector('.wb-state[role="alert"]')!
      expect(panel.textContent).toContain('no longer have access')
      expect(Array.from(panel.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
        'Choose another workspace',
      ])
      await act(async () => panel.querySelector('button')!.click())
      expect(document.activeElement).toBe(workspaceSelect())
    },
  )
})
