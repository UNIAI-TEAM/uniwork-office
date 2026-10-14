/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, useState } from 'react'
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
import { SkillDomainTabs } from '../src/renderer/src/SkillDomainTabs'
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
    facets: { org: 'Acme', status: 'Đang làm' },
    tags: ['q4'],
    notes: 'Call Linh',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
} as unknown as ProjectSummaryEntry
const PACK2 = {
  ...PACK,
  id: 'p2',
  name: 'Beta lease',
  fileCount: 0,
  lastActiveAt: '2026-10-11T00:00:00Z',
  practice: { ...PACK.practice!, title: 'Beta lease', facets: {}, tags: [], notes: '' },
} as unknown as ProjectSummaryEntry

let host: HTMLDivElement
let root: Root
let project: {
  listFiles: ReturnType<typeof vi.fn>
  deleteProject: ReturnType<typeof vi.fn>
  patchPracticeMeta: ReturnType<typeof vi.fn>
  getPracticeMeta: ReturnType<typeof vi.fn>
  createPracticeProject: ReturnType<typeof vi.fn>
}

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
    uniworkListSharedWithMe: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    uniworkDocStatus: vi.fn(async () => null),
    onUniworkDocStatus: vi.fn(() => () => undefined),
    listDrafts: vi.fn(async () => []),
    setLanguage: vi.fn(async () => undefined),
    openPath: vi.fn(async () => undefined),
    revealPath: vi.fn(async () => undefined),
    deleteFiles: vi.fn(async () => undefined),
    newDoc: vi.fn(async () => undefined),
    newSheet: vi.fn(async () => undefined),
    newSlide: vi.fn(async () => undefined),
    newPdf: vi.fn(async () => undefined),
  } as unknown as HomeApi
  window.uniworkWork = {
    homeSummary: vi.fn(async () => ({ ok: false, error: 'offline' })),
    setTaskStatus: vi.fn(),
    openWeb: vi.fn(async () => true),
  } as unknown as UniworkWorkApi
  project = {
    listFiles: vi.fn(async () => [] as string[]),
    deleteProject: vi.fn(async () => undefined),
    patchPracticeMeta: vi.fn(async () => undefined),
    getPracticeMeta: vi.fn(async () => null),
    createPracticeProject: vi.fn(async (args: { title: string }) => ({
      ...PACK,
      id: 'new1',
      practice: { ...PACK.practice!, title: args.title },
    })),
  }
  window.aiOfficeProject = project as unknown as typeof window.aiOfficeProject
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

type PillarId = 'knowledge' | 'materials' | 'skills' | 'compose'

async function openPillar(
  projects: ProjectSummaryEntry[],
  selectedId: string | null,
  pillarId: PillarId = 'knowledge',
) {
  pinPillar(PRACTICE.id, pillarId)
  const props = {
    practice: PRACTICE,
    projects,
    selectedId,
    onSelectPack: vi.fn(),
    onOpenPackFiles: vi.fn(),
    onRefresh: vi.fn(),
    onSwitchPractice: vi.fn(),
    newItems: [],
  }
  // the parent owns the selection, as Home does
  function Harness() {
    const [sel, setSel] = useState(selectedId)
    return createElement(PracticeHome, {
      ...props,
      selectedId: sel,
      onSelectPack: (id: string | null) => {
        props.onSelectPack(id)
        setSel(id)
      },
    })
  }
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(Harness)))
  })
  await flush()
  await clickTab(pillarId)
  return props
}

const tabButton = (pillarId: PillarId) => {
  const label = PRACTICE.pillars.find((p) => p.id === pillarId)!.labelEn
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button.wb-tab')).find((b) =>
    b.textContent?.includes(label),
  )
}

async function clickTab(pillarId: PillarId) {
  const tab = tabButton(pillarId)
  expect(tab, `${pillarId} tab`).toBeTruthy()
  await act(async () => tab!.click())
  await flush()
}

const activeTab = () => host.querySelector('button.wb-tab.active')?.textContent ?? ''

const buttonByText = (text: string, scope: ParentNode = host) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )

async function click(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy()
  el!.focus()
  await act(async () => el!.click())
  await flush()
}

/** open a ⋯ / menu trigger by accessible name and choose an item by its text */
async function chooseMenu(trigger: HTMLElement, item: string) {
  await click(trigger)
  const entry = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (b) => b.textContent?.includes(item),
  )
  expect(entry, item).toBeTruthy()
  await act(async () => entry!.click())
  await flush()
}

const byLabel = (label: string) =>
  host.querySelector<HTMLElement>(`[aria-label="${label.replace(/"/g, '\\"')}"]`)

async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(input) as object
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function key(el: HTMLElement, k: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

const toastText = () => host.querySelector('.wb-toast-host .wb-toast')?.textContent ?? ''

describe('Knowledge (redesign spec 4.7)', () => {
  it('toolbar: search with an icon, the count, the local tag and a secondary New pack', async () => {
    await openPillar([], null)
    expect(host.querySelector('.wb-toolbar h2.uw-sr-only')?.textContent).toBe(KNOWLEDGE.labelEn)
    expect(host.querySelector('.wb-toolbar-text')?.textContent).toBe('Packs: 0')
    expect(host.querySelector('.wb-toolbar .wb-local-tag')).not.toBeNull()
    const search = host.querySelector<HTMLInputElement>('.wb-toolbar .wb-kn-search input.wb-input')!
    expect(search.getAttribute('aria-label')).toBe('Search packs')
    expect(search.placeholder).toBe('Search packs by name, tag or note')
    expect(host.querySelector('.wb-kn-search svg')).not.toBeNull()
    const labelledBy = host.querySelector('section.wb-pane')?.getAttribute('aria-labelledby')
    expect(labelledBy && document.getElementById(labelledBy)?.textContent).toBe(KNOWLEDGE.labelEn)
    const add = buttonByText('New pack', host.querySelector('.wb-toolbar')!)!
    expect(add.className).toBe('wb-btn wb-btn-secondary')
    await click(add)
    expect(activeTab()).toContain('Compose')
  })

  it('no packs at all: the full panel offers "Create your first pack"', async () => {
    await openPillar([], null)
    const state = host.querySelector('.wb-pane .wb-state')!
    expect(state.classList.contains('is-compact')).toBe(false)
    expect(state.querySelector('.wb-state-title')?.textContent).toBe('No packs yet')
    expect(state.querySelector('.wb-state-icon svg')).not.toBeNull()
    await click(buttonByText('Create your first pack', state))
    expect(activeTab()).toContain('Compose')
  })

  it('a search with no hits is a compact "no match" with Clear search, not the empty library', async () => {
    await openPillar([PACK, PACK2], null)
    const search = host.querySelector<HTMLInputElement>('.wb-kn-search input')!
    await type(search, 'zzz')
    const state = host.querySelector('.wb-kn-list .wb-state')!
    expect(state.classList.contains('is-compact')).toBe(true)
    expect(state.querySelector('.wb-state-title')?.textContent).toBe('No pack matches “zzz”')
    expect(host.textContent).not.toContain('No packs yet')
    await click(buttonByText('Clear search', state))
    expect(search.value).toBe('')
    expect(host.querySelectorAll('.wb-pack-item')).toHaveLength(2)
  })

  it('pack rows: title, facets, a file pill; the selected one is aria-current and a second click keeps it (spec 5.4)', async () => {
    const props = await openPillar([PACK, PACK2], 'p1')
    const items = Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-pack-item'))
    expect(items.map((b) => b.querySelector('.wb-pack-title')?.textContent)).toEqual([
      'Acme deal',
      'Beta lease',
    ])
    expect(items[0]!.querySelector('.wb-row-sub')?.textContent).toBe('Acme · Đang làm')
    expect(items.map((b) => b.querySelector('.wb-pill')?.textContent)).toEqual([
      'Files: 2',
      'No files yet',
    ])
    expect(items[0]!.getAttribute('aria-current')).toBe('true')
    expect(items[0]!.classList.contains('active')).toBe(true)
    expect(items[1]!.hasAttribute('aria-current')).toBe(false)
    await click(items[0])
    expect(props.onSelectPack).toHaveBeenLastCalledWith('p1')
    expect(props.onSelectPack).not.toHaveBeenCalledWith(null)
    await click(items[1])
    expect(props.onSelectPack).toHaveBeenLastCalledWith('p2')
  })

  it('the detail head: 20/600 title, facet pills, two secondary buttons and a ⋯ menu', async () => {
    const props = await openPillar([PACK], 'p1')
    const detail = host.querySelector('.wb-kn-detail')!
    expect(detail.querySelector('h3.wb-kn-title')?.textContent).toBe('Acme deal')
    expect(detail.getAttribute('aria-labelledby')).toBe(detail.querySelector('h3')!.id)
    expect(
      Array.from(detail.querySelectorAll('.wb-kn-facets .wb-pill')).map((p) => p.textContent),
    ).toEqual(['Acme', 'Đang làm'])
    const actions = detail.querySelector('.wb-kn-head-actions')!
    expect(
      Array.from(actions.querySelectorAll('.wb-btn-secondary')).map((b) => b.textContent),
    ).toEqual(['Pack materials', 'View files'])
    expect(host.querySelector('section.wb-pane .btn')).toBeNull()
    await click(buttonByText('View files', actions))
    expect(props.onOpenPackFiles).toHaveBeenCalledWith('p1')
    await click(buttonByText('Pack materials', actions))
    expect(activeTab()).toContain('Materials')
  })

  it('files in the pack: three rows, then "See all N files" to Materials', async () => {
    project.listFiles.mockResolvedValue([
      '/a/One.docx',
      '/a/Two.xlsx',
      '/a/Three.pptx',
      '/a/Four.pdf',
    ])
    await openPillar([PACK], 'p1')
    const rows = host.querySelectorAll('.wb-kn-files .wb-kn-file')
    expect(Array.from(rows).map((r) => r.textContent)).toEqual([
      'One.docx',
      'Two.xlsx',
      'Three.pptx',
    ])
    await click(rows[0]!.querySelector('button'))
    expect(window.aiOffice.openPath).toHaveBeenCalledWith('/a/One.docx')
    await click(buttonByText('See all 4 files'))
    expect(activeTab()).toContain('Materials')
  })

  it('tags are chips with their own remove button; Enter adds one; Save writes tags and notes', async () => {
    await openPillar([PACK], 'p1')
    const tags = host.querySelector('.wb-kn-tags')!
    expect(Array.from(tags.querySelectorAll('.wb-kn-tag')).map((c) => c.textContent)).toEqual([
      'q4',
    ])
    const save = buttonByText('Save', host.querySelector('.wb-kn-foot')!)!
    // nothing changed: no unsaved note and both buttons locked
    expect(host.querySelector('.wb-kn-foot')?.textContent).not.toContain('Unsaved changes')
    expect(save.disabled).toBe(true)
    expect(save.className).toBe('wb-btn wb-btn-primary wb-btn-sm')

    const input = tags.querySelector<HTMLInputElement>('input')!
    expect(input.getAttribute('aria-label')).toBe('Add a tag')
    await type(input, 'launch')
    await key(input, 'Enter')
    expect(Array.from(tags.querySelectorAll('.wb-kn-tag')).map((c) => c.textContent)).toEqual([
      'q4',
      'launch',
    ])
    expect(input.value).toBe('')
    await click(byLabel('Remove tag q4'))
    expect(Array.from(tags.querySelectorAll('.wb-kn-tag')).map((c) => c.textContent)).toEqual([
      'launch',
    ])
    const notes = host.querySelector<HTMLTextAreaElement>('.wb-kn-section textarea')!
    await type(notes, 'Call Linh on Friday')
    expect(host.querySelector('.wb-kn-foot')?.textContent).toContain('Unsaved changes')
    expect(save.disabled).toBe(false)
    await click(save)
    expect(project.patchPracticeMeta).toHaveBeenCalledWith({
      projectId: 'p1',
      patch: { notes: 'Call Linh on Friday', tags: ['launch'] },
    })
    expect(toastText()).toContain('Saved.')
  })

  it('Discard changes puts the stored tags and notes back', async () => {
    await openPillar([PACK], 'p1')
    const notes = host.querySelector<HTMLTextAreaElement>('.wb-kn-section textarea')!
    await type(notes, 'scratch')
    await click(byLabel('Remove tag q4'))
    await click(buttonByText('Discard changes'))
    expect(notes.value).toBe('Call Linh')
    expect(host.querySelectorAll('.wb-kn-tag')).toHaveLength(1)
    expect(host.querySelector('.wb-kn-foot')?.textContent).not.toContain('Unsaved changes')
  })
})

describe('in-app confirmations and page toasts (redesign spec 2.3, 5.3)', () => {
  it('Delete pack… sits in the ⋯ menu and asks in a WbConfirm; Cancel keeps it, Delete removes it', async () => {
    const native = vi.spyOn(window, 'confirm')
    await openPillar([PACK], 'p1')
    const more = byLabel('More actions')!
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    await chooseMenu(more, 'Delete pack…')
    const dialog = host.querySelector<HTMLElement>('.wb-confirm[role="alertdialog"]')!
    expect(dialog.textContent).toContain('Delete pack “Acme deal”?')
    expect(native).not.toHaveBeenCalled()
    // focus starts on Cancel; Cancel closes with no delete and gives focus back to the ⋯
    expect(document.activeElement?.textContent).toBe('Cancel')
    await act(async () => (document.activeElement as HTMLButtonElement).click())
    expect(host.querySelector('.wb-confirm')).toBeNull()
    expect(project.deleteProject).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(more)

    await chooseMenu(more, 'Delete pack…')
    const confirm = host.querySelector<HTMLButtonElement>('.wb-confirm .wb-btn-danger')!
    expect(confirm.textContent).toBe('Delete pack')
    await act(async () => confirm.click())
    await flush()
    expect(project.deleteProject).toHaveBeenCalledWith('p1')
    // the ⋯ went busy (disabled): focus lands on the pack list, not <body>
    expect(document.activeElement?.classList.contains('wb-pack-list')).toBe(true)
    // the notice is a toast in the one host, not a line pinned above every tab
    expect(host.querySelector('.wb-hint, .wb-error')).toBeNull()
    expect(toastText()).toContain('Pack removed from Knowledge.')
    native.mockRestore()
  })

  it('the confirm deletes the pack it names, even when another pack was selected meanwhile', async () => {
    const props = await openPillar([PACK, PACK2], 'p1')
    await chooseMenu(byLabel('More actions')!, 'Delete pack…')
    expect(host.querySelector('.wb-confirm')?.textContent).toContain('Delete pack “Acme deal”?')
    // select p2 behind the open confirm (a scripted click: no mousedown closes it)
    const beta = Array.from(host.querySelectorAll<HTMLElement>('.wb-pack-item')).find((b) =>
      b.textContent?.includes('Beta lease'),
    )!
    await act(async () => beta.click())
    await flush()
    expect(props.onSelectPack).toHaveBeenLastCalledWith('p2')
    expect(host.querySelector('.wb-confirm')).not.toBeNull()
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.wb-confirm .wb-btn-danger')!.click(),
    )
    await flush()
    expect(project.deleteProject).toHaveBeenCalledTimes(1)
    expect(project.deleteProject).toHaveBeenCalledWith('p1')
    // p2 is still the selection: only a delete of the selected pack clears it
    expect(props.onSelectPack).not.toHaveBeenCalledWith(null)
  })

  it('Delete file… in a Materials row asks in a WbConfirm, then sends the file to the trash', async () => {
    const native = vi.spyOn(window, 'confirm')
    project.listFiles.mockResolvedValue(['/a/Plan.docx'])
    await openPillar([PACK], 'p1', 'materials')
    await chooseMenu(byLabel('More actions: Plan.docx')!, 'Delete file…')
    const dialog = host.querySelector<HTMLElement>('.wb-confirm[role="alertdialog"]')!
    expect(dialog.querySelector('.wb-confirm-title')?.textContent).toBe('Delete file “Plan.docx”?')
    expect(dialog.querySelector('.wb-confirm-body')?.textContent).toBe(
      'The file goes to the trash on this computer.',
    )
    await click(buttonByText('Cancel', dialog))
    expect(window.aiOffice.deleteFiles).not.toHaveBeenCalled()

    await chooseMenu(byLabel('More actions: Plan.docx')!, 'Delete file…')
    project.listFiles.mockResolvedValue([])
    await click(host.querySelector<HTMLButtonElement>('.wb-confirm .wb-btn-danger'))
    expect(window.aiOffice.deleteFiles).toHaveBeenCalledWith(['/a/Plan.docx'])
    expect(native).not.toHaveBeenCalled()
    // the row and its ⋯ are gone: focus lands on the pane, not <body>
    expect(document.activeElement?.classList.contains('wb-pane')).toBe(true)
    expect(host.querySelector('.wb-mat-row')).toBeNull()
    native.mockRestore()
  })
})

describe('Knowledge follows the projects Home hands down', () => {
  /** PracticeHome under a parent that owns the projects, as Home does */
  async function mountLive(initial: ProjectSummaryEntry[]) {
    const live: { set?: (p: ProjectSummaryEntry[]) => void } = {}
    const onRefresh = vi.fn()
    function Harness() {
      const [projects, setProjects] = useState(initial)
      const [sel, setSel] = useState<string | null>(initial[0]?.id ?? null)
      live.set = setProjects
      return createElement(PracticeHome, {
        practice: PRACTICE,
        projects,
        selectedId: sel,
        onSelectPack: setSel,
        onOpenPackFiles: vi.fn(),
        onRefresh,
        onSwitchPractice: vi.fn(),
        newItems: [],
      })
    }
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(Harness)))
    })
    await flush()
    await clickTab('knowledge')
    return { setProjects: (p: ProjectSummaryEntry[]) => live.set!(p), onRefresh }
  }

  it('deleting the last pack: focus lands on the Knowledge pane, not <body>', async () => {
    const { setProjects, onRefresh } = await mountLive([PACK])
    onRefresh.mockImplementation(() => setProjects([]))
    await chooseMenu(byLabel('More actions')!, 'Delete pack…')
    await click(host.querySelector<HTMLButtonElement>('.wb-confirm .wb-btn-danger'))
    expect(project.deleteProject).toHaveBeenCalledWith('p1')
    expect(host.querySelector('.wb-pack-list')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('section.wb-pane'))
  })

  it('a refresh that brings the same tags back keeps unsaved edits', async () => {
    const { setProjects } = await mountLive([PACK])
    await click(byLabel('Remove tag q4'))
    const notes = host.querySelector<HTMLTextAreaElement>('.wb-kn-section textarea')!
    await type(notes, 'Call Linh on Friday')
    // a refresh: new objects and a new tags array, the same stored values
    await act(async () =>
      setProjects([
        { ...PACK, practice: { ...PACK.practice!, tags: ['q4'] } } as ProjectSummaryEntry,
      ]),
    )
    await flush()
    expect(host.querySelectorAll('.wb-kn-tag')).toHaveLength(0)
    expect(notes.value).toBe('Call Linh on Friday')
    expect(host.querySelector('.wb-kn-foot')?.textContent).toContain('Unsaved changes')
  })

  it('the Materials pack chip lists packs in the Knowledge order, latest active first', async () => {
    const older = { ...PACK2, lastActiveAt: '2026-10-01T00:00:00Z' } as ProjectSummaryEntry
    const newer = { ...PACK, lastActiveAt: '2026-10-14T00:00:00Z' } as ProjectSummaryEntry
    pinPillar(PRACTICE.id, 'materials')
    await mountLive([older, newer])
    await clickTab('materials')
    const options = Array.from(host.querySelectorAll('.wb-toolbar .wb-crumb select option'))
    expect(options.map((o) => o.textContent).slice(1)).toEqual(['Acme deal', 'Beta lease'])
  })
})

describe('Materials (redesign spec 4.8)', () => {
  it('no pack: the panel sends you to Knowledge', async () => {
    await openPillar([PACK], null, 'materials')
    expect(host.querySelector('.wb-state-title')?.textContent).toBe('No pack selected')
    await click(buttonByText('Choose a pack in Knowledge'))
    expect(activeTab()).toContain('Knowledge')
  })

  it('toolbar: the pack chip, the file count and Add material as a menu of roles', async () => {
    project.listFiles.mockResolvedValue(['/a/Plan.docx'])
    await openPillar([PACK], 'p1', 'materials')
    const bar = host.querySelector('.wb-toolbar')!
    expect(bar.querySelector('.wb-crumb .wb-crumb-name')?.textContent).toBe('Pack: Acme deal')
    expect(bar.querySelector<HTMLSelectElement>('.wb-crumb select')!.value).toBe('p1')
    expect(bar.querySelector('.wb-toolbar-text')?.textContent).toBe('Files: 1')
    const add = buttonByText('Add material', bar)!
    expect(add.className).toBe('wb-btn wb-btn-secondary')
    await chooseMenu(add, 'Report')
    expect(window.aiOffice.newDoc).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1' }),
    )
  })

  it('file rows: badge, name, role pill, Open, and ⋯ with Show in folder', async () => {
    project.listFiles.mockResolvedValue(['/a/Plan.docx'])
    const pack = {
      ...PACK,
      practice: { ...PACK.practice!, materials: { '/a/Plan.docx': 'report' } },
    } as unknown as ProjectSummaryEntry
    await openPillar([pack], 'p1', 'materials')
    const row = host.querySelector('.wb-mat-files .wb-mat-row')!
    expect(row.querySelector('img, svg')).not.toBeNull()
    expect(row.querySelector('.wb-mat-name')?.textContent).toBe('Plan.docx')
    expect(row.querySelector('.wb-pill')?.textContent).toBe('Report')
    const open = buttonByText('Open', row)!
    expect(open.className).toBe('wb-btn wb-btn-secondary wb-btn-sm')
    await click(open)
    expect(window.aiOffice.openPath).toHaveBeenCalledWith('/a/Plan.docx')
    await chooseMenu(byLabel('More actions: Plan.docx')!, 'Show in folder')
    expect(window.aiOffice.revealPath).toHaveBeenCalledWith('/a/Plan.docx')
  })

  it('a file list that cannot be read is an error with Retry, not an empty pack', async () => {
    project.listFiles.mockRejectedValueOnce(new Error('EACCES'))
    await openPillar([PACK], 'p1', 'materials')
    const state = host.querySelector('.wb-mat-files .wb-state')!
    expect(state.getAttribute('role')).toBe('alert')
    expect(host.textContent).not.toContain('No files in this pack yet')
    project.listFiles.mockResolvedValueOnce(['/a/Plan.docx'])
    await click(state.querySelector('button'))
    expect(host.querySelector('.wb-mat-name')?.textContent).toBe('Plan.docx')
  })

  it('an empty pack: a compact panel in the card', async () => {
    await openPillar([PACK], 'p1', 'materials')
    const state = host.querySelector('.wb-mat-files .wb-state')!
    expect(state.classList.contains('is-compact')).toBe(true)
    expect(state.textContent).toBe('No files in this pack yet')
  })

  it('quick create: four localized tiles (no Docs/Sheets/Slides) and the role templates', async () => {
    await openPillar([PACK], 'p1', 'materials')
    const quick = host.querySelector('.wb-pillar-section')!
    expect(quick.querySelector('h3.wb-sec-title')?.textContent).toBe('Quick create from a template')
    const tiles = Array.from(quick.querySelectorAll<HTMLButtonElement>('.wb-mat-tile'))
    expect(tiles.map((b) => b.textContent)).toEqual([
      'Blank document',
      'Spreadsheet',
      'Presentation',
      'PDF',
    ])
    expect(host.textContent).not.toMatch(/\bDocs\b|\bSheets\b|\bSlides\b/)
    await click(tiles[1])
    expect(window.aiOffice.newSheet).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(buttonByText('Open the template sequence in order')?.className).toBe('wb-link')
  })

  it('a quick create that fails says what failed in an alert toast; Retry creates again', async () => {
    ;(window.aiOffice.newSheet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('no space left'),
    )
    await openPillar([PACK], 'p1', 'materials')
    const tiles = Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-mat-tile'))
    await click(tiles[1])
    const toast = host.querySelector('.wb-toast[role="alert"]')!
    expect(toast.textContent).toContain('Couldn’t create the document. no space left')
    await click(buttonByText('Retry', toast))
    expect(window.aiOffice.newSheet).toHaveBeenCalledTimes(2)
    expect(host.querySelector('.wb-toast[role="alert"]')).toBeNull()
  })

  it('a role template that fails is reported too, not swallowed', async () => {
    ;(window.aiOffice.newDoc as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'))
    await openPillar([PACK], 'p1', 'materials')
    const tpl = host.querySelector<HTMLButtonElement>('.wb-pillar-section .wb-chip-row button')
    expect(tpl).toBeTruthy()
    await click(tpl)
    expect(host.querySelector('.wb-toast[role="alert"]')?.textContent).toContain(
      'Couldn’t create the document. boom',
    )
  })
})

describe('Skills (redesign spec 4.9)', () => {
  it('toolbar: the context chip and the per-run cost; no pack: a compact panel and locked Run', async () => {
    await openPillar([PACK], null, 'skills')
    const bar = host.querySelector('.wb-toolbar')!
    expect(bar.querySelector('.wb-crumb-name')?.textContent).toBe('Context: No pack selected')
    expect(bar.querySelector('.wb-toolbar-text')?.textContent).toBe('Each run uses 1 AI credit')
    const state = host.querySelector('.wb-pane > .wb-state')!
    expect(state.classList.contains('is-compact')).toBe(true)
    expect(state.textContent).toBe('Choose a pack as context before running a skill')
    expect(
      Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-sk-row button')).every(
        (b) => b.disabled,
      ),
    ).toBe(true)
  })

  it('rows: spark tile, name, description, a translated category pill and a secondary Run', async () => {
    await openPillar([PACK], 'p1', 'skills')
    const heads = Array.from(host.querySelectorAll('.wb-pane h3.wb-sec-title')).map(
      (h) => h.textContent,
    )
    expect(heads).toEqual([`For your role · ${PRACTICE.labelEn}`, 'By field'])
    const rows = Array.from(host.querySelectorAll('.wb-sk-row'))
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) {
      expect(row.querySelector('.wb-icon-tile svg')).not.toBeNull()
      const pill = row.querySelector('.wb-pill')?.textContent ?? ''
      // never a raw catalogue key such as "ai", "ho-so" or "bao-gia"
      expect(pill).not.toMatch(/^[a-z]+(-[a-z]+)*$/)
      const run = row.querySelector<HTMLButtonElement>('button')!
      expect(run.className).toBe('wb-btn wb-btn-secondary wb-btn-sm')
      expect(run.querySelector('svg')).not.toBeNull()
      expect(run.textContent).toBe('Run')
    }
    expect(rows[0]!.querySelector('.wb-pill')?.textContent).toBe('AI')
  })

  it('Run asks in a WbConfirm naming the skill and the pack; Esc closes it', async () => {
    await openPillar([PACK], 'p1', 'skills')
    const row = host.querySelector('.wb-sk-row')!
    const name = row.querySelector('.wb-sk-name')!.textContent
    await click(row.querySelector('button'))
    expect(host.querySelector('.modal, .modal-overlay')).toBeNull()
    const dialog = host.querySelector('.wb-confirm')!
    expect(dialog.querySelector('.wb-confirm-title')?.textContent).toBe(
      `Run “${name}” with the pack Acme deal?`,
    )
    expect(dialog.querySelector('.wb-confirm-body')?.textContent).toBe('Uses 1 AI credit.')
    expect(dialog.querySelector('.wb-btn-primary')?.textContent).toBe('Run')
    await key(dialog as HTMLElement, 'Escape')
    expect(host.querySelector('.wb-confirm')).toBeNull()
  })

  it('a confirmed Run opens the document with the skill set to run in the pack', async () => {
    await openPillar([PACK], 'p1', 'skills')
    await click(host.querySelector('.wb-sk-row button'))
    await click(host.querySelector<HTMLButtonElement>('.wb-confirm .wb-btn-primary'))
    const calls = [
      ...(window.aiOffice.newDoc as ReturnType<typeof vi.fn>).mock.calls,
      ...(window.aiOffice.newSlide as ReturnType<typeof vi.fn>).mock.calls,
    ]
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toEqual(
      expect.objectContaining({
        projectId: 'p1',
        aiPreset: expect.objectContaining({ autoRun: true }),
      }),
    )
  })

  it('a run that fails names the skill in an alert toast; Retry asks again before spending', async () => {
    ;(window.aiOffice.newDoc as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'))
    ;(window.aiOffice.newSlide as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'))
    await openPillar([PACK], 'p1', 'skills')
    const row = host.querySelector('.wb-sk-row')!
    const name = row.querySelector('.wb-sk-name')!.textContent
    await click(row.querySelector('button'))
    await click(host.querySelector<HTMLButtonElement>('.wb-confirm .wb-btn-primary'))
    const toast = host.querySelector('.wb-toast[role="alert"]')!
    expect(toast.textContent).toContain(`Couldn’t run “${name}”. offline`)
    await click(buttonByText('Retry', toast))
    // the run costs a credit: Retry opens the confirm, it does not run on its own
    expect(host.querySelector('.wb-confirm .wb-confirm-title')?.textContent).toContain(name!)
  })
})

describe('skill domains: a segmented control (redesign spec 4.9)', () => {
  async function mountTabs(lang: 'en' | 'vi' = 'en') {
    const onSelect = vi.fn()
    store.set('uniwork.skill.domain.pins', JSON.stringify(['health', 'legal', 'design']))
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(SkillDomainTabs, { vi: lang === 'vi', active: 'legal', onSelect }),
        ),
      )
    })
    return onSelect
  }
  const segments = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.skill-domain-tab'))

  it('each domain is a plain toggle button: nothing interactive nested inside it', async () => {
    await mountTabs()
    const group = host.querySelector('.skill-domain-tabs')!
    expect(group.getAttribute('role')).toBe('group')
    expect(segments().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ])
    for (const seg of segments()) {
      expect(seg.querySelector('button, [role="button"], [tabindex], a, input')).toBeNull()
      expect(seg.draggable).toBe(false)
    }
    expect(host.querySelector('.skill-domain-tab-unpin, .skill-domain-tab-grip')).toBeNull()
  })

  it('the ⋯ menu moves and unpins the shown domain', async () => {
    const onSelect = await mountTabs()
    const more = byLabel('Arrange fields')!
    await chooseMenu(more, 'Move “Law & Compliance” earlier')
    expect(segments().map((b) => b.textContent)).toEqual([
      'LLaw & Compliance',
      'HHealthcare',
      'DDesign consulting',
    ])
    expect(JSON.parse(store.get('uniwork.skill.domain.pins')!)).toEqual([
      'legal',
      'health',
      'design',
    ])
    await chooseMenu(more, 'Unpin “Law & Compliance”')
    expect(segments()).toHaveLength(2)
    expect(onSelect).toHaveBeenLastCalledWith('health')
  })

  it('unpinning down to one pin removes the ⋯: focus lands on the shown domain, not <body>', async () => {
    store.set('uniwork.skill.domain.pins', JSON.stringify(['health', 'legal']))
    function Harness() {
      const [active, setActive] = useState<'health' | 'legal'>('legal')
      return createElement(SkillDomainTabs, {
        vi: false,
        active,
        onSelect: (id) => setActive(id as 'health' | 'legal'),
      })
    }
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(Harness)))
    })
    await chooseMenu(byLabel('Arrange fields')!, 'Unpin “Law & Compliance”')
    expect(byLabel('Arrange fields')).toBeNull()
    expect(document.activeElement).toBe(segments()[0])
    expect(segments()[0]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('a shown domain that is not pinned (an agent opened it) gets no ⋯ that could not act on it', async () => {
    store.set('uniwork.skill.domain.pins', JSON.stringify(['health', 'legal']))
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(SkillDomainTabs, { vi: false, active: 'design', onSelect: vi.fn() }),
        ),
      )
    })
    expect(segments()).toHaveLength(2)
    expect(byLabel('Arrange fields')).toBeNull()
  })

  it('Add a field is a ghost button that opens a menu of unpinned domains', async () => {
    const onSelect = await mountTabs()
    const add = buttonByText('Add a field')!
    expect(add.className).toBe('wb-btn wb-btn-ghost wb-btn-sm')
    expect(add.getAttribute('aria-haspopup')).toBe('menu')
    await click(add)
    const items = Array.from(host.querySelectorAll('[role="menuitem"]')).map(
      (b) => b.querySelector('.wb-menu-label')?.textContent,
    )
    expect(items).not.toContain('Healthcare')
    expect(items.length).toBeGreaterThan(0)
    await act(async () => (host.querySelector('[role="menuitem"]') as HTMLButtonElement).click())
    expect(segments()).toHaveLength(4)
    expect(onSelect).toHaveBeenCalled()
  })

  it('the badge letter follows the UI language', async () => {
    await mountTabs('vi')
    expect(segments()[0]!.querySelector('.wb-domain-badge')?.textContent).toBe('Y')
  })
})

describe('Compose (redesign spec 4.10, 5.2, 5.5)', () => {
  it('the form card in sections, the footer note and the "What\'s in a pack?" card', async () => {
    await openPillar([PACK], null, 'compose')
    expect(host.querySelector('.wb-toolbar-text')?.textContent).toBe('Create a new work pack')
    expect(host.querySelector('.wb-toolbar .wb-local-tag')).not.toBeNull()
    const form = host.querySelector('form.wb-cmp-form')!
    expect(Array.from(form.querySelectorAll('h3.wb-sec-title')).map((h) => h.textContent)).toEqual([
      'Main details',
      'Classification',
    ])
    expect(form.querySelectorAll('input.wb-input, select.wb-input, textarea.wb-input').length).toBe(
      PRACTICE.facets.length + 2,
    )
    // required fields carry the * mark
    const labels = Array.from(form.querySelectorAll('label.wb-field-label')).map(
      (l) => l.textContent,
    )
    expect(labels.filter((l) => l?.endsWith(' *'))).toHaveLength(
      PRACTICE.facets.filter((f) => f.required).length,
    )
    expect(form.querySelector('.wb-cmp-foot')?.textContent).toContain(
      'Once created, the pack opens in Knowledge.',
    )
    expect(buttonByText('Create pack', form)?.type).toBe('submit')
    expect(buttonByText('Cancel', form)?.className).toBe('wb-btn wb-btn-ghost')
    const aside = host.querySelector('.wb-cmp-aside')!
    expect(aside.querySelector('h3')?.textContent).toBe("What's in a pack?")
    expect(aside.querySelectorAll('li')).toHaveLength(3)
  })

  it('missing fields: an error line under each, aria-invalid, focus on the first; nothing is created', async () => {
    await openPillar([PACK], null, 'compose')
    const form = host.querySelector<HTMLFormElement>('form.wb-cmp-form')!
    await act(async () => form.requestSubmit())
    await flush()
    expect(project.createPracticeProject).not.toHaveBeenCalled()
    const invalid = Array.from(form.querySelectorAll<HTMLInputElement>('[aria-invalid="true"]'))
    // the title and the free-text required facet (selects start on their first option)
    expect(invalid.length).toBe(2)
    expect(document.activeElement).toBe(invalid[0])
    for (const field of invalid) {
      const err = document.getElementById(field.getAttribute('aria-describedby')!)!
      expect(err.className).toBe('wb-field-error')
      expect(err.textContent).toBe('This field is required')
    }
    // field errors stay at the field: no page toast
    expect(host.querySelector('.wb-toast')).toBeNull()
    await type(invalid[0]!, 'Launch')
    expect(invalid[0]!.hasAttribute('aria-invalid')).toBe(false)
    expect(form.querySelectorAll('.wb-field-error')).toHaveLength(1)
  })

  it('creating selects the new pack in Knowledge and opens no document; the toast offers the first one', async () => {
    const props = await openPillar([PACK], null, 'compose')
    const form = host.querySelector<HTMLFormElement>('form.wb-cmp-form')!
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input.wb-input'))
    // title, org, tags (in that order)
    await type(inputs[0]!, 'Launch Q4')
    await type(inputs[1]!, 'Acme')
    await type(inputs[2]!, 'q4, launch')
    await type(form.querySelector('textarea')!, 'Kick-off on Monday')
    await act(async () => form.requestSubmit())
    await flush()
    expect(project.createPracticeProject).toHaveBeenCalledWith(
      expect.objectContaining({
        practiceId: PRACTICE.id,
        title: 'Launch Q4',
        tags: ['q4', 'launch'],
        notes: 'Kick-off on Monday',
        facets: expect.objectContaining({ org: 'Acme' }),
      }),
    )
    expect(window.aiOffice.newDoc).not.toHaveBeenCalled()
    expect(window.aiOffice.newSheet).not.toHaveBeenCalled()
    expect(window.aiOffice.newSlide).not.toHaveBeenCalled()
    expect(props.onSelectPack).toHaveBeenCalledWith('new1')
    expect(activeTab()).toContain('Knowledge')
    expect(toastText()).toContain('Created the pack “Launch Q4”')
    await click(buttonByText('Draft the first document', host.querySelector('.wb-toast')!))
    expect(window.aiOffice.newDoc).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'new1' }),
    )
  })
})

describe('CSS', () => {
  const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
  it('the Knowledge, Compose and Materials grids follow the spec', () => {
    expect(css).toMatch(/\n\.wb-kn \{[^}]*grid-template-columns: 340px minmax\(0, 1fr\);/)
    expect(css).toMatch(/\n\.wb-cmp \{[^}]*grid-template-columns: minmax\(0, 720px\) 300px;/)
    expect(css).toMatch(
      /\n\.wb-mat-tiles \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/,
    )
    expect(css).toMatch(/\n\.wb-kn-title \{[^}]*font-size: 20px;[^}]*font-weight: 600;/)
    expect(css).toMatch(/\n\.wb-sec-title \{[^}]*font-size: 13px;[^}]*font-weight: 600;/)
    expect(css).toMatch(/\n\.wb-pack-item\.active \{\n {2}background: var\(--accent-soft\);/)
    expect(css).toMatch(
      /\n\.wb-field-error \{\n {2}color: var\(--danger-text\);\n {2}font-size: 12px;/,
    )
    expect(css).toMatch(/\n\.wb-row-actions \{[^}]*display: inline-flex;[^}]*flex-wrap: nowrap;/)
  })
})
