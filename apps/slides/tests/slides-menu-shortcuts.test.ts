// @vitest-environment node
/**
 * UNI-2011: the slides application menu takes its accelerators from the
 * @genoffice/shortcuts slides table (no chord written by hand where the table
 * has a row), and Developer Tools only appear in dev builds (P0: packaged
 * Slides used to show them, unlike Docs and Sheets).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { electronModule } from './helpers/slides-ipc-harness'

vi.mock('electron', async () => (await import('./helpers/slides-ipc-harness')).electronModule)
vi.mock('@genoffice/electron-utils', async () => ({
  ...(await import('./helpers/slides-ipc-harness')).electronUtilsModule,
  helpMenuTemplate: () => ({ label: 'Help', submenu: [] }),
  toggleDevToolsItem: () => ({ label: 'Developer Tools', accelerator: 'Ctrl+Shift+I' }),
}))
// menu labels as their keys, so the assertions read the same in every UI language
vi.mock('../src/main/i18n-main', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/i18n-main')>()),
  tm: (key: string) => key,
}))
vi.mock('../src/main/fonts', () => ({
  createSystemFontMetrics: () => ({}),
  resetFontRegistry: () => {},
  registerEmbeddedFonts: () => false,
  listPrivateFontFaces: () => [],
  getPrivateFontData: () => null,
}))
vi.mock('../src/main/shaped-metrics', () => ({
  refineComplexWidths: async () => false,
  shapedMetricsReady: async () => {},
}))
vi.mock('../src/main/font-store', () => ({
  downloadFontFamily: async () => {},
  initFontStore: () => {},
  installLocalFontFiles: () => [],
  listFontCatalog: () => [],
  missingCatalogFonts: () => [],
}))
vi.mock('../src/main/ai-ipc', () => ({
  registerAiIpc: () => {},
  registerSlidesOnlyAiIpc: () => {},
}))
vi.mock('../src/main/presenter-show', () => ({ registerPresenterIpc: () => {} }))
vi.mock('../src/main/attachments-ipc', () => ({ registerAttachmentIpc: () => {} }))
vi.mock('../src/main/generated-page-temp', () => ({
  cleanupExpiredGeneratedPages: async () => {},
}))
vi.mock('../src/main/pdf-export', () => ({ exportSlidesPdf: async () => ({ ok: false }) }))
vi.mock('@genoffice/ai-search', () => ({
  gskApiKey: () => '',
  gskSlideGenerate: async () => ({ bytes: new Uint8Array(), model: '' }),
  setGskProxyUrl: () => {},
}))
vi.mock('@genoffice/project-store', () => ({ ProjectStore: class {} }))
vi.mock('@genoffice/pipelines/slides', () => ({
  buildPagePptx: async () => ({ bytes: new Uint8Array(), imageFailures: [] }),
  parsePageSpec: () => ({ ok: false, error: 'not in the harness' }),
}))

type Item = MenuItemConstructorOptions
let buildSlidesMenu: typeof import('../src/main/slides-main').buildSlidesMenu
let setSlidesCloseTabHook: typeof import('../src/main/slides-main').setSlidesCloseTabHook
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

// slides-main pulls in the whole engine: allow the cold import more than the 10 s hook default
beforeAll(async () => {
  const main = await import('../src/main/slides-main')
  buildSlidesMenu = main.buildSlidesMenu
  setSlidesCloseTabHook = main.setSlidesCloseTabHook
}, 60_000)

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  electronModule.app.isPackaged = true
  setSlidesCloseTabHook(null)
})

/** The template buildSlidesMenu hands to Menu.buildFromTemplate, flattened. */
function menuItems(os: NodeJS.Platform, packaged: boolean): Item[] {
  Object.defineProperty(process, 'platform', { ...platform, value: os })
  electronModule.app.isPackaged = packaged
  let template: Item[] = []
  // the harness Menu ignores its template; capture it for this one build
  const menu = electronModule.Menu as { buildFromTemplate: (t: Item[]) => object }
  const original = menu.buildFromTemplate
  menu.buildFromTemplate = (t) => {
    template = t
    return {}
  }
  setSlidesCloseTabHook(() => {})
  buildSlidesMenu()
  menu.buildFromTemplate = original
  const flat = (items: Item[]): Item[] =>
    items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flat(item.submenu) : [])])
  return flat(template)
}

const accelerators = (items: Item[]) =>
  Object.fromEntries(items.filter((i) => i.label).map((i) => [i.label, i.accelerator]))

describe('slides menu', () => {
  it.each(['win32', 'darwin'] as const)(
    '%s: File / Edit accelerators come from the table',
    (os) => {
      const acc = accelerators(menuItems(os, true))
      expect(acc).toMatchObject({
        menuOpen: 'CmdOrCtrl+O',
        menuSave: 'CmdOrCtrl+S',
        menuSaveAs: 'CmdOrCtrl+Shift+S',
        menuPrint: 'CmdOrCtrl+P',
        menuClose: 'CmdOrCtrl+W',
        menuUndo: 'CmdOrCtrl+Z',
        // PowerPoint's Redo is Ctrl+Y / Cmd+Y; the old Shift+Z chord is renderer-only
        menuRedo: 'CmdOrCtrl+Y',
      })
    },
  )

  it('hides Developer Tools in packaged builds, keeps them in dev builds', () => {
    const labels = (items: Item[]) => items.map((i) => i.label)
    expect(labels(menuItems('win32', true))).not.toContain('Developer Tools')
    expect(labels(menuItems('darwin', true))).not.toContain('Developer Tools')
    expect(labels(menuItems('win32', false))).toContain('Developer Tools')
  })
})
