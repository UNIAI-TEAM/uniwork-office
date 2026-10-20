import { beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny application menu: the Menu API the module uses, over plain objects.
interface FakeItem {
  id?: string
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

const { appMenuLabels, viewMenuTemplate } = await import('@genoffice/electron-utils')
const { chromeFollowsUiScale, withViewMenu } = await import('../src/main/ui-scale-menu')

const labels = {
  menuView: 'View',
  menuUiZoomIn: 'Interface zoom in',
  menuUiZoomOut: 'Interface zoom out',
  menuUiZoomReset: 'Reset interface zoom',
} as const
const label = (key: keyof typeof labels) => labels[key]

function scaleItems(): FakeItem[] {
  return state.items.flatMap(
    (i) => i.submenu?.items.filter((s) => s.id === 'ui-scale-zoom-in') ?? [],
  )
}

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

  it('adds a View menu with the zoom keys for Home, before Help', () => {
    withViewMenu('home', label, () => '/tmp/settings.json')
    expect(state.items.map((i) => i.label)).toEqual(['File', 'View', 'Help'])
    expect(accelerators()).toEqual(['CmdOrCtrl+=', 'CmdOrCtrl+-', '', 'CmdOrCtrl+0'])
  })

  it('gives Sheets the items without accelerators: its Ctrl+- and Ctrl+0 are Excel keys, Ctrl+Alt is AltGr', () => {
    withViewMenu('sheets', label, () => '/tmp/settings.json')
    expect(state.items.map((i) => i.label)).toEqual(['File', 'View', 'Help'])
    expect(accelerators()).toEqual(['', '', '', ''])
    expect(accelerators().some((a) => a.includes('Alt'))).toBe(false)
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
    expect(scaleItems()).toHaveLength(1)
    expect(state.items.map((i) => i.label)).toEqual(['File', 'View', 'Help'])
  })

  it.each([
    ['vi', 'Hiển thị'],
    ['it', 'Vista'],
    ['nl', 'Weergave'],
    ['pt', 'Visualização'],
    ['hi', 'व्यू'],
  ] as const)(
    'appends scale items to the existing Sheets View menu in %s instead of inserting a duplicate (R2-4)',
    async (lang, shellMenuView) => {
      const { Menu } = await import('electron')
      const appLabels = appMenuLabels(lang)
      expect(appLabels.view).not.toBe(shellMenuView)
      state.items = Menu.buildFromTemplate([
        { label: 'File', submenu: [] },
        viewMenuTemplate(appLabels, { pageZoom: false }),
        { label: appLabels.window, submenu: [] },
        { label: appLabels.help, role: 'help' },
      ]).items as unknown as FakeItem[]

      const shellLabel = (key: keyof typeof labels) =>
        key === 'menuView' ? shellMenuView : labels[key]

      withViewMenu('sheets', shellLabel, () => '/tmp/settings.json')
      withViewMenu('sheets', shellLabel, () => '/tmp/settings.json')

      expect(state.items.map((i) => i.label)).toEqual([
        'File',
        appLabels.view,
        appLabels.window,
        appLabels.help,
      ])
      const viewSubmenu = state.items[1]?.submenu?.items ?? []
      expect(viewSubmenu.filter((i) => i.label === 'Interface zoom in')).toHaveLength(1)
      expect(viewSubmenu.map((i) => i.label)).toContain('Reset interface zoom')
      expect(scaleItems()).toHaveLength(1)
    },
  )
})
