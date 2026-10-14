import { beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny application menu: the Menu API the module uses, over plain objects.
interface FakeItem {
  label?: string
  role?: string
  accelerator?: string
  submenu?: { items: FakeItem[]; append(item: FakeItem): void }
}
const state = vi.hoisted(() => ({ items: [] as FakeItem[] }))

vi.mock('electron', () => {
  const wrap = (template: Array<Record<string, unknown>>): { items: FakeItem[] } => ({
    items: template.map((t) => {
      const item: FakeItem = { ...(t as FakeItem) }
      if (Array.isArray(t.submenu)) item.submenu = wrap(t.submenu) as FakeItem['submenu']
      return item
    }),
  })
  const appendable = (items: FakeItem[]) => ({
    items,
    append: (item: FakeItem) => void items.push(item),
  })
  return {
    webContents: { getAllWebContents: () => [] },
    Menu: {
      getApplicationMenu: () => ({
        items: state.items,
        append: (item: FakeItem) => void state.items.push(item),
        insert: (at: number, item: FakeItem) => void state.items.splice(at, 0, item),
      }),
      buildFromTemplate: (template: Array<Record<string, unknown>>) => {
        const built = wrap(template)
        for (const item of built.items) {
          if (item.submenu) item.submenu = appendable(item.submenu.items)
        }
        return built
      },
    },
  }
})

const { chromeFollowsUiScale, withViewMenu } = await import('../src/main/ui-scale-menu')

const labels = {
  menuView: 'View',
  menuUiZoomIn: 'Interface zoom in',
  menuUiZoomOut: 'Interface zoom out',
  menuUiZoomReset: 'Reset interface zoom',
} as const
const label = (key: keyof typeof labels) => labels[key]

function accelerators(): string[] {
  return state.items.flatMap((i) => i.submenu?.items.map((s) => s.accelerator ?? '') ?? [])
}

beforeEach(() => {
  state.items = [
    { label: 'File', submenu: appendableFile() },
    { label: 'Help', role: 'help' },
  ]
})

function appendableFile(): NonNullable<FakeItem['submenu']> {
  const items: FakeItem[] = []
  return { items, append: (item) => void items.push(item) }
}

describe('the interface-scale View items (R1-4)', () => {
  it('only the tab kinds whose chrome follows the scale offer them', () => {
    expect(chromeFollowsUiScale('home')).toBe(true)
    expect(chromeFollowsUiScale('sheets')).toBe(true)
    for (const kind of ['docs', 'slides', 'pdf', 'markdown', 'html'] as const) {
      expect(chromeFollowsUiScale(kind)).toBe(false)
    }
  })

  it('adds a View menu with the three accelerators for Home and Sheets, before Help', () => {
    withViewMenu('sheets', label, () => '/tmp/settings.json')
    expect(state.items.map((i) => i.label)).toEqual(['File', 'View', 'Help'])
    expect(accelerators()).toEqual(['CmdOrCtrl+Alt+=', 'CmdOrCtrl+Alt+-', '', 'CmdOrCtrl+Alt+0'])
  })

  it('leaves the menu of Docs, Slides, PDF, Markdown and HTML tabs untouched', () => {
    for (const kind of ['docs', 'slides', 'pdf', 'markdown', 'html'] as const) {
      withViewMenu(kind, label, () => '/tmp/settings.json')
    }
    expect(state.items.map((i) => i.label)).toEqual(['File', 'Help'])
    expect(accelerators()).toEqual([])
  })

  it('appends to an existing View menu once', () => {
    state.items.splice(1, 0, { label: 'View', submenu: appendableFile() })
    withViewMenu('home', label, () => '/tmp/settings.json')
    withViewMenu('home', label, () => '/tmp/settings.json')
    expect(accelerators().filter((a) => a === 'CmdOrCtrl+Alt+=')).toHaveLength(1)
    expect(state.items.map((i) => i.label)).toEqual(['File', 'View', 'Help'])
  })
})
