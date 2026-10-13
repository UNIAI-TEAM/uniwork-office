/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requirePractice } from '@uniwork/practice-core'
import type { HomeApi, ProjectSummaryEntry } from '../src/shared/home-api'
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
import { pinPillar } from '../src/renderer/src/workbench-pins'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const PRACTICE = requirePractice('entrepreneur')
const KNOWLEDGE = PRACTICE.pillars.find((p) => p.id === 'knowledge')!
const PACK = {
  id: 'p1',
  name: 'Acme deal',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  fileCount: 2,
  lastActiveAt: '2026-10-12T00:00:00Z',
  isDefault: false,
  kind: PRACTICE.projectKind,
  practice: {
    practiceId: PRACTICE.id,
    title: 'Acme deal',
    facets: {},
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
} as unknown as ProjectSummaryEntry

let host: HTMLDivElement
let root: Root

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  store.clear()
  pinPillar(PRACTICE.id, 'knowledge')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  window.aiOffice = {
    uniworkListWorkspaces: vi.fn(async () => ({ ok: true, value: [] })),
    accountStatus: vi.fn(async () => ({
      loggedIn: true,
      state: 'signed-in',
      profile: { accountId: 'u1', email: 'linh@acme.vn', displayName: 'Linh' },
    })),
    accountLogin: vi.fn(async () => true),
    recents: vi.fn(async () => ({ entries: [], total: 0, totalAll: 0 })),
    uniworkListDocuments: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    setLanguage: vi.fn(async () => undefined),
  } as unknown as HomeApi
  window.uniworkWork = {
    homeSummary: vi.fn(async () => ({ ok: false, error: 'offline' })),
    setTaskStatus: vi.fn(),
    openWeb: vi.fn(async () => true),
  } as unknown as UniworkWorkApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function openKnowledge(
  projects: ProjectSummaryEntry[],
  selectedId: string | null,
  pillarId: 'knowledge' | 'materials' | 'skills' = 'knowledge',
) {
  pinPillar(PRACTICE.id, pillarId)
  const label = PRACTICE.pillars.find((p) => p.id === pillarId)!.labelEn
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(PracticeHome, {
          practice: PRACTICE,
          projects,
          selectedId,
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
  const tab = Array.from(host.querySelectorAll<HTMLButtonElement>('button.wb-tab')).find((b) =>
    b.textContent?.includes(label),
  )
  expect(tab, `${label} tab`).toBeTruthy()
  await act(async () => tab!.click())
  await flush()
}

describe('Knowledge pillar (redesign spec 4.8)', () => {
  it('a pane header, a search box with a leading icon and an empty library panel', async () => {
    await openKnowledge([], null)
    expect(host.querySelector('.wb-pane-title')?.textContent).toBe(KNOWLEDGE.labelEn)
    expect(host.querySelector('.wb-pane-aside .wb-local-tag')).not.toBeNull()
    const labelledBy = host.querySelector('section.wb-pane')?.getAttribute('aria-labelledby')
    expect(labelledBy && document.getElementById(labelledBy)?.textContent).toBe(KNOWLEDGE.labelEn)
    const search = host.querySelector<HTMLInputElement>('.wb-kn-search input')!
    expect(search.getAttribute('aria-label')).toBe('Search')
    expect(search.placeholder).toBe('Title, tags, notes…')
    expect(host.querySelector('.wb-kn-search svg')).not.toBeNull()
    expect(host.querySelector('.wb-packs .wb-count')?.textContent).toBe('0')
    expect(host.querySelector('.wb-packs .wb-state')?.textContent).toContain(
      'No packs yet. Create in Compose.',
    )
    expect(host.querySelector('.wb-panel')).toBeNull()
  })

  it('a selected pack: flat buttons in the detail, no pill or black button', async () => {
    await openKnowledge([PACK], 'p1')
    expect(host.querySelector('.wb-packs .wb-count')?.textContent).toBe('1')
    expect(host.querySelector('section.wb-pane .btn')).toBeNull()
    expect(host.querySelectorAll('.wb-detail .wb-btn-secondary')).toHaveLength(3)
    expect(host.querySelector('.wb-detail .wb-btn-primary')?.textContent).toBe('Save')
  })
})

describe('pillar empty sentences use the shared state panel (redesign spec 5)', () => {
  const state = () => ({
    title: host.querySelector('.wb-state .wb-state-title')?.textContent,
    tile: host.querySelector('.wb-state .wb-state-icon svg') !== null,
    bare: host.querySelector('.wb-empty'),
  })

  it('Knowledge: packs but none selected', async () => {
    await openKnowledge([PACK], null)
    expect(host.querySelector('.wb-detail .wb-state-title')?.textContent).toBe('Select a pack.')
    expect(state()).toMatchObject({ tile: true, bare: null })
  })

  it('Materials: no pack selected', async () => {
    await openKnowledge([PACK], null, 'materials')
    expect(state()).toEqual({ title: 'Select a Knowledge pack first.', tile: true, bare: null })
  })

  it('Materials: a pack with no files draws the panel instead of an empty list', async () => {
    await openKnowledge([PACK], 'p1', 'materials')
    expect(state()).toEqual({ title: 'No files yet — add below.', tile: true, bare: null })
    expect(host.querySelector('.wb-material-list')).toBeNull()
  })

  it('Skills: no pack selected', async () => {
    await openKnowledge([PACK], null, 'skills')
    expect(state()).toEqual({
      title: 'Select a Knowledge pack for context before running.',
      tile: true,
      bare: null,
    })
  })

  it('CSS: Materials row actions stay one horizontal cluster', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    // a bare `.wb-material-row div` (0,1,1) beat `.wb-row-actions` (0,1,0) and stacked the icons
    expect(css).not.toMatch(/\.wb-(?:material|skill)-row div\b/)
    expect(css).toContain(
      '\n.wb-material-row > div:first-child,\n.wb-skill-row > div:first-child {',
    )
    expect(css).toMatch(/\n\.wb-row-actions \{[^}]*display: inline-flex;[^}]*flex-wrap: nowrap;/)
  })
})
