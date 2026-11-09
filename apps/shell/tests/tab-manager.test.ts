import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => {
  const realpathSync = ((path?: string) => {
    if (path === undefined) return undefined
    if (path === '/real/file' || path === '/canonical/file' || path === '/REAL/FILE')
      return '/real/file'
    return path
  }) as typeof import('node:fs').realpathSync

  realpathSync.native = ((path?: string) => {
    if (path === undefined) return undefined
    if (path === '/real/file' || path === '/canonical/file' || path === '/REAL/FILE')
      return '/real/file'
    return path
  }) as typeof import('node:fs').realpathSync.native

  return { realpathSync }
})

/**
 * TabManager (src/main/tab-manager.ts): tab list state, activation,
 * close guards, and view lifecycle inside the shell's single window.
 * Electron and the per-module main entrypoints are mocked; only the
 * manager's own observable behavior is asserted.
 */

interface FakeWebContents {
  id: number
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  isFocused: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  isDevToolsOpened: ReturnType<typeof vi.fn>
  openDevTools: ReturnType<typeof vi.fn>
  closeDevTools: ReturnType<typeof vi.fn>
  listeners: Map<string, () => void>
}

interface FakeView {
  webContents: FakeWebContents
  setVisible: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
}

let nextWebContentsId = 1

function makeFakeView(): FakeView {
  const listeners = new Map<string, () => void>()
  return {
    webContents: {
      id: nextWebContentsId++,
      listeners,
      on: vi.fn((event: string, handler: () => void) => {
        listeners.set(event, handler)
      }),
      once: vi.fn(),
      close: vi.fn(),
      loadURL: vi.fn(async () => undefined),
      reload: vi.fn(),
      focus: vi.fn(),
      isFocused: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
      isDevToolsOpened: vi.fn(() => false),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
    },
    setVisible: vi.fn(),
    setBounds: vi.fn(),
  }
}

vi.mock('electron', () => ({
  BrowserWindow: class {},
  // the manual's view is constructed inline in tab-manager (createHelpView),
  // unlike the editor views which arrive through mocked module factories, so
  // the electron mock itself must construct one. Self-contained: no outside
  // references (vi.mock factories run before the module body). The large id
  // stays clear of makeFakeView's counter.
  WebContentsView: class {
    webContents = {
      id: 900001,
      setWindowOpenHandler: () => ({ action: 'deny' as const }),
      loadURL: () => Promise.resolve(),
      focus: () => {},
      on: () => {},
      once: () => {},
      close: () => {},
      reload: () => {},
      isDestroyed: () => false,
    }
    setBounds = () => {}
    setVisible = () => {}
  },
}))

const createDocsView = vi.fn(() => makeFakeView())
const docsQueryDirty = vi.fn(() => Promise.resolve(false))
const docsQueryEditorDirty = vi.fn((): Promise<boolean | null> => Promise.resolve(false))
const markDocsNewBlank = vi.fn()
const queueDocsForView = vi.fn()
const requestDocsClose = vi.fn(() => Promise.resolve(true))
const setActiveDocsResolver = vi.fn()
const teardownDocsRenderer = vi.fn()

vi.mock('../../docs/src/main/docs-main', () => ({
  createDocsView: (...args: unknown[]) => createDocsView(...(args as [])),
  docsQueryDirty: (...args: unknown[]) => docsQueryDirty(...(args as [])),
  docsQueryEditorDirty: (...args: unknown[]) => docsQueryEditorDirty(...(args as [])),
  markDocsNewBlank: (...args: unknown[]) => markDocsNewBlank(...args),
  queueDocsForView: (...args: unknown[]) => queueDocsForView(...args),
  requestDocsClose: (...args: unknown[]) => requestDocsClose(...(args as [])),
  setActiveDocsResolver: (...args: unknown[]) => setActiveDocsResolver(...args),
  teardownDocsRenderer: (...args: unknown[]) => teardownDocsRenderer(...args),
}))

const createPdfView = vi.fn(() => makeFakeView())
const pdfIsDirty = vi.fn(() => false)
const clearPdfDirty = vi.fn()
const requestPdfClose = vi.fn(() => Promise.resolve(true))

vi.mock('../../pdf/src/main/pdf-main', () => ({
  createPdfView: (...args: unknown[]) => createPdfView(...(args as [])),
  pdfIsDirty: (...args: unknown[]) => pdfIsDirty(...(args as [])),
  clearPdfDirty: (...args: unknown[]) => clearPdfDirty(...(args as [])),
  requestPdfClose: (...args: unknown[]) => requestPdfClose(...(args as [])),
}))

const createSheetsView = vi.fn(() => makeFakeView())
const nudgeQueuedWorkbook = vi.fn()
const queueWorkbookForView = vi.fn()
const requestSheetsClose = vi.fn(() => Promise.resolve(true))
const setActiveSheetsWebContents = vi.fn()
const setSheetsNewBlank = vi.fn()
const sheetsPendingEditCount = vi.fn(() => 0)

vi.mock('../../sheets/src/main/sheets-main', () => ({
  createSheetsView: (...args: unknown[]) => createSheetsView(...(args as [])),
  nudgeQueuedWorkbook: (...args: unknown[]) => nudgeQueuedWorkbook(...args),
  queueWorkbookForView: (...args: unknown[]) => queueWorkbookForView(...args),
  requestSheetsClose: (...args: unknown[]) => requestSheetsClose(...(args as [])),
  setActiveSheetsWebContents: (...args: unknown[]) => setActiveSheetsWebContents(...args),
  setSheetsNewBlank: (...args: unknown[]) => setSheetsNewBlank(...args),
  sheetsPendingEditCount: (...args: unknown[]) => sheetsPendingEditCount(...(args as [])),
}))

const createSlidesView = vi.fn(() => makeFakeView())
const queueSlidesForView = vi.fn()
const requestSlidesClose = vi.fn(() => Promise.resolve(true))
const setActiveSlidesWebContents = vi.fn()
const slidesIsDirty = vi.fn(() => false)

vi.mock('../../slides/src/main/slides-main', () => ({
  createSlidesView: (...args: unknown[]) => createSlidesView(...(args as [])),
  queueSlidesForView: (...args: unknown[]) => queueSlidesForView(...args),
  requestSlidesClose: (...args: unknown[]) => requestSlidesClose(...(args as [])),
  setActiveSlidesWebContents: (...args: unknown[]) => setActiveSlidesWebContents(...args),
  slidesIsDirty: (...args: unknown[]) => slidesIsDirty(...(args as [])),
}))

const createMarkdownView = vi.fn(() => makeFakeView())
const markdownIsDirty = vi.fn(() => false)
const requestMarkdownClose = vi.fn(() => Promise.resolve(true))

vi.mock('../../markdown/src/main/markdown-main', () => ({
  createMarkdownView: (...args: unknown[]) => createMarkdownView(...(args as [])),
  markdownIsDirty: (...args: unknown[]) => markdownIsDirty(...(args as [])),
  requestMarkdownClose: (...args: unknown[]) => requestMarkdownClose(...(args as [])),
}))

const createHtmlView = vi.fn(() => makeFakeView())
const createHtmlPresentView = vi.fn(() => makeFakeView())
const htmlIsDirty = vi.fn(() => false)
const requestHtmlClose = vi.fn(() => Promise.resolve(true))

vi.mock('../../html/src/main/html-main', () => ({
  createHtmlView: (...args: unknown[]) => createHtmlView(...(args as [])),
  createHtmlPresentView: (...args: unknown[]) => createHtmlPresentView(...(args as [])),
  htmlIsDirty: (...args: unknown[]) => htmlIsDirty(...(args as [])),
  requestHtmlClose: (...args: unknown[]) => requestHtmlClose(...(args as [])),
}))

import { isAiRunning, noteAiRun, resetAiRunRegistry } from '../src/main/ai-run-registry'
import { TabManager } from '../src/main/tab-manager'
import type { TabKind } from '../src/shared/tabs-api'
import { tabStripHeight } from '../src/shared/tab-drag-geometry'

const TAB_STRIP_HEIGHT = 40
const WINDOW_WIDTH = 800
const WINDOW_HEIGHT = 600

interface FakeShellWindow {
  on: ReturnType<typeof vi.fn>
  webContents: {
    on: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    listeners: Map<string, () => void>
  }
  isDestroyed: ReturnType<typeof vi.fn>
  isFocused: ReturnType<typeof vi.fn>
  getContentBounds: () => { x: number; y: number; width: number; height: number }
  contentView: {
    addChildView: ReturnType<typeof vi.fn>
    removeChildView: ReturnType<typeof vi.fn>
  }
}

function makeShellWindow(): FakeShellWindow {
  const listeners = new Map<string, () => void>()
  return {
    on: vi.fn(),
    webContents: {
      on: vi.fn((event: string, handler: () => void) => {
        listeners.set(event, handler)
      }),
      once: vi.fn(),
      focus: vi.fn(),
      isDevToolsOpened: vi.fn(() => false),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
      listeners,
    },
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    getContentBounds: () => ({ x: 0, y: 0, width: WINDOW_WIDTH, height: WINDOW_HEIGHT }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  }
}

let shellWindow: FakeShellWindow
let onChanged: ReturnType<typeof vi.fn>
let applyMenuFor: ReturnType<typeof vi.fn>
let manager: TabManager

function lastCreatedView(factory: ReturnType<typeof vi.fn>): FakeView {
  return factory.mock.results.at(-1)!.value as FakeView
}

beforeEach(() => {
  resetAiRunRegistry()
  vi.clearAllMocks()
  nextWebContentsId = 1
  docsQueryDirty.mockImplementation(() => Promise.resolve(false))
  requestDocsClose.mockImplementation(() => Promise.resolve(true))
  pdfIsDirty.mockImplementation(() => false)
  sheetsPendingEditCount.mockImplementation(() => 0)
  slidesIsDirty.mockImplementation(() => false)
  shellWindow = makeShellWindow()
  onChanged = vi.fn()
  applyMenuFor = vi.fn()
  manager = new TabManager(
    shellWindow as never,
    () => onChanged(),
    (kind) => applyMenuFor(kind),
  )
})

describe('initial state', () => {
  it('starts with only the non-closable, active Home tab', () => {
    expect(manager.list()).toEqual([
      { id: 'home', kind: 'home', title: 'UniWork Office', closable: false, active: true },
    ])
  })
})

describe('F6 / Shift+F6 and F12 key events', () => {
  type InputHandler = (event: { preventDefault: () => void }, input: unknown) => void
  const key = (over: Record<string, unknown> = {}) => ({
    type: 'keyDown',
    key: 'F6',
    code: 'F6',
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...over,
  })
  const press = (wc: { listeners: Map<string, () => void> }, input: unknown) => {
    const preventDefault = vi.fn()
    const handler = wc.listeners.get('before-input-event') as unknown as InputHandler
    handler({ preventDefault }, input)
    return preventDefault
  }

  it('F6 moves focus from the shell chrome to the active tab and back', () => {
    manager.openPdfTab('/tmp/a.pdf')
    const view = lastCreatedView(createPdfView)
    view.webContents.focus.mockClear()
    shellWindow.webContents.focus.mockClear()
    expect(press(shellWindow.webContents, key())).toHaveBeenCalledTimes(1)
    expect(view.webContents.focus).toHaveBeenCalledTimes(1)
    expect(press(view.webContents, key({ shift: true }))).toHaveBeenCalledTimes(1)
    expect(shellWindow.webContents.focus).toHaveBeenCalledTimes(1)
  })

  it('leaves F6 to the page on Home (one region) and from a hidden view', () => {
    expect(press(shellWindow.webContents, key())).not.toHaveBeenCalled()
    manager.openSheetsTab()
    manager.openPdfTab('/tmp/a.pdf')
    const hiddenSheets = createSheetsView.mock.results[0]!.value as FakeView
    expect(press(hiddenSheets.webContents, key())).not.toHaveBeenCalled()
  })

  it('does not take F6 while an IME composition is running', () => {
    manager.openPdfTab('/tmp/a.pdf')
    expect(press(shellWindow.webContents, key({ isComposing: true }))).not.toHaveBeenCalled()
  })

  describe('F12', () => {
    beforeEach(() => {
      manager = new TabManager(
        shellWindow as never,
        () => onChanged(),
        (kind) => applyMenuFor(kind),
        undefined,
        () => 1,
        () => true,
      )
    })

    it('toggles the detached developer tools of a tab whose module does not bind F12', () => {
      manager.openPdfTab('/tmp/a.pdf')
      const view = lastCreatedView(createPdfView)
      const f12 = key({ key: 'F12', code: 'F12' })
      expect(press(view.webContents, f12)).toHaveBeenCalledTimes(1)
      expect(view.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
      view.webContents.isDevToolsOpened.mockReturnValue(true)
      press(view.webContents, f12)
      expect(view.webContents.closeDevTools).toHaveBeenCalledTimes(1)
    })

    it('leaves F12 to Save As in Sheets', () => {
      manager.openSheetsTab()
      const view = lastCreatedView(createSheetsView)
      expect(press(view.webContents, key({ key: 'F12', code: 'F12' }))).not.toHaveBeenCalled()
      expect(view.webContents.openDevTools).not.toHaveBeenCalled()
    })

    it('does nothing in a packaged build', () => {
      manager = new TabManager(
        shellWindow as never,
        () => onChanged(),
        (kind) => applyMenuFor(kind),
      )
      manager.openPdfTab('/tmp/a.pdf')
      const view = lastCreatedView(createPdfView)
      expect(press(view.webContents, key({ key: 'F12', code: 'F12' }))).not.toHaveBeenCalled()
      expect(view.webContents.openDevTools).not.toHaveBeenCalled()
    })
  })
})

describe('opening tabs', () => {
  it('focuses the help tab already open instead of opening a second one', () => {
    // F1 is a toggle-shaped key in practice: press it, read something, press it
    // again. The help tab is closable (only Home is not), so a second copy is
    // never what the reader meant.
    const first = manager.openHelpTab()
    expect(manager.list()).toHaveLength(2)
    const second = manager.openHelpTab()
    expect(second).toBe(first)
    expect(manager.list()).toHaveLength(2)
    expect(manager.list()[1]).toMatchObject({ id: first, kind: 'help', active: true })
    expect(shellWindow.contentView.addChildView).toHaveBeenCalledTimes(1)
  })

  it('reactivates the help tab when another tab took over', () => {
    const helpId = manager.openHelpTab()
    const docsId = manager.openDocsTab()
    expect(manager.list().find((t) => t.id === docsId)?.active).toBe(true)
    manager.openHelpTab()
    expect(manager.list().find((t) => t.id === helpId)?.active).toBe(true)
    expect(manager.list().find((t) => t.id === docsId)?.active).toBe(false)
  })

  it('opens a fresh help tab once the previous one was closed', () => {
    const first = manager.openHelpTab()
    manager.closeTabWithoutPrompt(first)
    const second = manager.openHelpTab()
    expect(second).not.toBe(first)
    expect(manager.list().filter((t) => t.kind === 'help')).toHaveLength(1)
  })

  it('opens a docs tab, activates it, and attaches its view to the window', () => {
    const id = manager.openDocsTab()
    const tabs = manager.list()
    expect(tabs).toHaveLength(2)
    expect(tabs[1]).toMatchObject({
      id,
      kind: 'docs',
      title: 'UniWork Docs',
      closable: true,
      active: true,
    })
    expect(tabs[0].active).toBe(false)
    expect(shellWindow.contentView.addChildView).toHaveBeenCalledTimes(1)
    expect(applyMenuFor).toHaveBeenLastCalledWith('docs')
    expect(onChanged).toHaveBeenCalled()
  })

  it('titles file-backed tabs with the file basename', () => {
    manager.openDocsTab('/tmp/report.docx')
    manager.openSheetsTab('/tmp/budget.xlsx')
    manager.openSlidesTab('/tmp/deck.pptx')
    manager.openPdfTab('/tmp/scan.pdf')
    expect(manager.list().map((t) => t.title)).toEqual([
      'UniWork Office',
      'report.docx',
      'budget.xlsx',
      'deck.pptx',
      'scan.pdf',
    ])
  })

  it('uses module default titles for pathless tabs', () => {
    manager.openSheetsTab()
    manager.openSlidesTab()
    expect(manager.list().map((t) => t.title)).toEqual(['UniWork Office', 'AI Sheets', 'AI Slides'])
  })

  it('assigns unique, monotonic tab ids', () => {
    const a = manager.openDocsTab()
    const b = manager.openSheetsTab()
    expect(a).not.toBe(b)
    expect(a).toBe('t1')
    expect(b).toBe('t2')
  })

  it('forwards the new-blank flag to the module', () => {
    manager.openDocsTab(undefined, { newBlank: true })
    expect(markDocsNewBlank).toHaveBeenCalledTimes(1)
    manager.openSheetsTab(undefined, { newBlank: true })
    expect(setSheetsNewBlank).toHaveBeenCalledTimes(1)
  })
})

describe('spare sheets view', () => {
  it('does not warm Sheets during Home or Docs sessions', () => {
    vi.useFakeTimers()
    try {
      const homeLoaded = shellWindow.webContents.once.mock.calls.find(
        ([event]) => event === 'did-finish-load',
      )
      ;(homeLoaded?.[1] as (() => void) | undefined)?.()
      vi.advanceTimersByTime(5000)
      manager.openDocsTab('/tmp/report.docx')
      vi.advanceTimersByTime(5000)
      expect(createSheetsView).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('warms a spare while Sheets is active and hands it to the next open', () => {
    vi.useFakeTimers()
    try {
      manager.openSheetsTab('/tmp/first.xlsx')
      expect(createSheetsView).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(3000)
      expect(createSheetsView).toHaveBeenCalledTimes(2)
      const spare = lastCreatedView(createSheetsView)
      expect(shellWindow.contentView.addChildView).toHaveBeenCalledWith(spare)
      expect(spare.setVisible).toHaveBeenLastCalledWith(false)
      expect(manager.list()).toHaveLength(2)

      manager.openSheetsTab('/tmp/budget.xlsx')
      expect(createSheetsView).toHaveBeenCalledTimes(2)
      expect(queueWorkbookForView).toHaveBeenCalledWith(spare.webContents, '/tmp/budget.xlsx')
      expect(nudgeQueuedWorkbook).toHaveBeenCalledWith(spare.webContents)
      expect(spare.setVisible).toHaveBeenLastCalledWith(true)
      expect(manager.list()[2]).toMatchObject({
        kind: 'sheets',
        title: 'budget.xlsx',
        active: true,
      })

      vi.advanceTimersByTime(3000)
      expect(createSheetsView).toHaveBeenCalledTimes(3)
      expect(lastCreatedView(createSheetsView)).not.toBe(spare)
      expect(setActiveSheetsWebContents).toHaveBeenLastCalledWith(spare.webContents)
    } finally {
      vi.useRealTimers()
    }
  })

  it('creates a fresh view when no spare is ready and does not nudge it', () => {
    manager.openSheetsTab('/tmp/budget.xlsx')
    expect(createSheetsView).toHaveBeenCalledTimes(1)
    expect(createSheetsView).toHaveBeenCalledWith({
      includeAiHandlers: false,
      openingWorkbook: true,
    })
    expect(nudgeQueuedWorkbook).not.toHaveBeenCalled()
  })

  it('starts a new blank view without the opening state', () => {
    manager.openSheetsTab()
    expect(createSheetsView).toHaveBeenCalledWith({
      includeAiHandlers: false,
      openingWorkbook: false,
    })
  })

  it('drops a spare whose renderer died instead of handing it out', () => {
    vi.useFakeTimers()
    try {
      manager.openSheetsTab()
      vi.advanceTimersByTime(3000)
      const spare = lastCreatedView(createSheetsView)
      const gone = spare.webContents.once.mock.calls.find(
        ([event]) => event === 'render-process-gone',
      )
      ;(gone![1] as () => void)()
      expect(spare.webContents.close).toHaveBeenCalledTimes(1)
      manager.openSheetsTab()
      expect(createSheetsView).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a pending spare and closes an existing spare on leaving Sheets', () => {
    vi.useFakeTimers()
    try {
      const sheetsId = manager.openSheetsTab()
      manager.openDocsTab()
      vi.advanceTimersByTime(3000)
      expect(createSheetsView).toHaveBeenCalledTimes(1)

      manager.activateTab(sheetsId)
      vi.advanceTimersByTime(3000)
      expect(createSheetsView).toHaveBeenCalledTimes(2)
      const spare = lastCreatedView(createSheetsView)
      manager.activateTab('home')
      expect(shellWindow.contentView.removeChildView).toHaveBeenCalledWith(spare)
      expect(spare.webContents.close).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays off under GENOFFICE_NO_SPARE_VIEW', () => {
    vi.stubEnv('GENOFFICE_NO_SPARE_VIEW', '1')
    vi.useFakeTimers()
    try {
      manager.openSheetsTab()
      vi.advanceTimersByTime(5000)
      expect(createSheetsView).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
      vi.unstubAllEnvs()
    }
  })
})

describe('hasWebContents (IPC sender guard registry)', () => {
  it('knows tab views, the warm spare sheets view, and nothing else', async () => {
    vi.useFakeTimers()
    try {
      manager.openDocsTab('/tmp/a.docx')
      const docsView = lastCreatedView(createDocsView)
      manager.openSheetsTab('/tmp/b.xlsx')
      const sheetsView = lastCreatedView(createSheetsView)
      expect(manager.hasWebContents(docsView.webContents.id)).toBe(true)
      expect(manager.hasWebContents(sheetsView.webContents.id)).toBe(true)
      expect(manager.hasWebContents(987654)).toBe(false)

      // the spare is not a tab yet, and is trusted before a sheets tab takes it
      vi.advanceTimersByTime(3000)
      const spare = lastCreatedView(createSheetsView)
      expect(spare).not.toBe(sheetsView)
      expect(manager.list()).toHaveLength(3)
      expect(manager.hasWebContents(spare.webContents.id)).toBe(true)

      // once its tab closes the view is no longer a trusted editor view
      await manager.closeTab('t2')
      expect(manager.hasWebContents(sheetsView.webContents.id)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('activation', () => {
  it('shows only the activated tab view and lays it out below the tab strip', () => {
    const docsId = manager.openDocsTab()
    const docsView = lastCreatedView(createDocsView)
    manager.openSheetsTab()
    const sheetsView = lastCreatedView(createSheetsView)

    manager.activateTab(docsId)
    expect(docsView.setVisible).toHaveBeenLastCalledWith(true)
    expect(sheetsView.setVisible).toHaveBeenLastCalledWith(false)
    expect(docsView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })
    expect(manager.list().find((t) => t.id === docsId)?.active).toBe(true)
  })

  it('hands keyboard focus to the activated view so typing works right after open/switch', () => {
    const docsId = manager.openDocsTab()
    const docsView = lastCreatedView(createDocsView)
    expect(docsView.webContents.focus).toHaveBeenCalled()

    docsView.webContents.focus.mockClear()
    manager.activateTab('home')
    expect(shellWindow.webContents.focus).toHaveBeenCalled()
    manager.activateTab(docsId)
    expect(docsView.webContents.focus).toHaveBeenCalledTimes(1)
  })

  it('does not steal OS focus for a background open (window unfocused)', () => {
    shellWindow.isFocused.mockReturnValue(false)
    manager.openDocsTab()
    const docsView = lastCreatedView(createDocsView)
    expect(docsView.webContents.focus).not.toHaveBeenCalled()

    // the window `focus` handler runs it once the user comes back
    shellWindow.isFocused.mockReturnValue(true)
    manager.focusActiveView()
    expect(docsView.webContents.focus).toHaveBeenCalledTimes(1)
  })

  it('ignores activation of unknown tab ids', () => {
    onChanged.mockClear()
    manager.activateTab('nope')
    expect(onChanged).not.toHaveBeenCalled()
    expect(manager.list()[0].active).toBe(true)
  })

  it('routes the active webContents to the matching module', () => {
    manager.openSheetsTab()
    const sheetsView = lastCreatedView(createSheetsView)
    expect(setActiveSheetsWebContents).toHaveBeenLastCalledWith(sheetsView.webContents)

    manager.openSlidesTab()
    const slidesView = lastCreatedView(createSlidesView)
    expect(setActiveSlidesWebContents).toHaveBeenLastCalledWith(slidesView.webContents)
  })

  it('lets the active view cover the tab strip during HTML fullscreen', () => {
    manager.openSlidesTab()
    const view = lastCreatedView(createSlidesView)
    view.webContents.listeners.get('enter-html-full-screen')!()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    })
    view.webContents.listeners.get('leave-html-full-screen')!()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })
  })
})

describe('window resize layout', () => {
  function resizeHandler(): () => void {
    const call = shellWindow.on.mock.calls.find((c) => c[0] === 'resize')
    expect(call).toBeDefined()
    return call![1] as () => void
  }

  it('re-lays out after resize bounds settle (Linux/X11 stale getContentBounds)', async () => {
    // On X11, `resize` fires before the WM applies maximize bounds, so the first
    // layout still sees the pre-maximize size. The deferred layout must pick up
    // the real size on the next turn (see issue #15).
    manager.openSheetsTab()
    const view = lastCreatedView(createSheetsView)
    view.setBounds.mockClear()

    let width = WINDOW_WIDTH
    let height = WINDOW_HEIGHT
    shellWindow.getContentBounds = () => ({ x: 0, y: 0, width, height })

    resizeHandler()()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })

    // Bounds update after the synchronous layout, as on X11 maximize.
    width = 1920
    height = 1080
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TAB_STRIP_HEIGHT,
      width: 1920,
      height: 1080 - TAB_STRIP_HEIGHT,
    })
    expect(view.setBounds).toHaveBeenCalledTimes(2)
  })

  it('skips deferred layout after the shell window is destroyed', async () => {
    manager.openSheetsTab()
    const view = lastCreatedView(createSheetsView)
    view.setBounds.mockClear()

    resizeHandler()()
    expect(view.setBounds).toHaveBeenCalledTimes(1)

    shellWindow.isDestroyed.mockReturnValue(true)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(view.setBounds).toHaveBeenCalledTimes(1)
  })
})

describe('closing tabs', () => {
  it('never closes the Home tab', async () => {
    await manager.closeTab('home')
    expect(manager.list()).toHaveLength(1)

    manager.openHomeTab()
    manager.closeActiveTab()
    await Promise.resolve()
    expect(manager.list()).toHaveLength(1)
  })

  describe('Ctrl/Cmd+W key event', () => {
    type InputHandler = (event: { preventDefault: () => void }, input: unknown) => void
    const chord = (over: Record<string, unknown> = {}) => ({
      type: 'keyDown',
      key: 'w',
      code: 'KeyW',
      control: true,
      meta: false,
      alt: false,
      shift: false,
      ...over,
    })
    const press = (wc: { listeners: Map<string, () => void> }, input: unknown) => {
      const preventDefault = vi.fn()
      const handler = wc.listeners.get('before-input-event') as unknown as InputHandler
      handler({ preventDefault }, input)
      return preventDefault
    }

    it('closes the active sheets tab without the menu accelerator', async () => {
      manager.openSheetsTab('/tmp/fresh.xlsx')
      const view = lastCreatedView(createSheetsView)
      const preventDefault = press(view.webContents, chord())
      expect(preventDefault).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect(manager.list().map((t) => t.id)).toEqual(['home']))
    })

    it('takes Ctrl+W under a non-Latin layout', async () => {
      manager.openSheetsTab()
      manager.openSheetsTab()
      press(lastCreatedView(createSheetsView).webContents, chord({ key: 'ц', code: 'KeyW' }))
      await vi.waitFor(() => expect(manager.list()).toHaveLength(2))
    })

    it('takes Cmd+W, not Ctrl+W, on macOS', async () => {
      const real = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      try {
        manager.openSheetsTab()
        const view = lastCreatedView(createSheetsView)
        expect(press(view.webContents, chord())).not.toHaveBeenCalled()
        expect(manager.list()).toHaveLength(2)
        press(view.webContents, chord({ control: false, meta: true }))
        await vi.waitFor(() => expect(manager.list()).toHaveLength(1))
      } finally {
        Object.defineProperty(process, 'platform', { value: real })
      }
    })

    it('does not take Cmd+W on Windows', () => {
      manager.openSheetsTab()
      const view = lastCreatedView(createSheetsView)
      expect(press(view.webContents, chord({ control: false, meta: true }))).not.toHaveBeenCalled()
      expect(manager.list()).toHaveLength(2)
    })

    it('ignores a key while an IME composition is running', () => {
      manager.openSheetsTab()
      const view = lastCreatedView(createSheetsView)
      expect(press(view.webContents, chord({ isComposing: true }))).not.toHaveBeenCalled()
      expect(manager.list()).toHaveLength(2)
    })

    it('ignores other chords, key repeat and key-up', () => {
      manager.openSheetsTab()
      const view = lastCreatedView(createSheetsView)
      for (const input of [
        chord({ key: 'q' }),
        chord({ control: false }),
        chord({ shift: true }),
        chord({ alt: true }),
        chord({ isAutoRepeat: true }),
        chord({ type: 'keyUp' }),
      ]) {
        expect(press(view.webContents, input)).not.toHaveBeenCalled()
      }
      expect(manager.list()).toHaveLength(2)
    })

    it('closes the active tab when the shell chrome holds keyboard focus', async () => {
      manager.openSheetsTab('/tmp/fresh.xlsx')
      const preventDefault = press(shellWindow.webContents, chord())
      expect(preventDefault).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect(manager.list().map((t) => t.id)).toEqual(['home']))
    })

    it('closes the active tab of any kind, whichever view of the window has focus', async () => {
      manager.openSheetsTab()
      const sheetsView = lastCreatedView(createSheetsView)
      manager.openDocsTab('/tmp/report.docx')
      // a hidden view holding focus still closes the tab the user sees
      press(sheetsView.webContents, chord())
      await vi.waitFor(() => expect(manager.list().map((t) => t.kind)).toEqual(['home', 'sheets']))
    })

    it('leaves the chord alone on Home', () => {
      manager.openSheetsTab()
      manager.openHomeTab()
      expect(press(shellWindow.webContents, chord())).not.toHaveBeenCalled()
      expect(manager.list()).toHaveLength(2)
    })

    it('does nothing from a view that moved to a detached window', async () => {
      const id = manager.openSheetsTab()
      const view = lastCreatedView(createSheetsView)
      manager.openSlidesTab()
      manager.detachTab(id)
      const preventDefault = press(view.webContents, chord())
      await Promise.resolve()
      expect(preventDefault).not.toHaveBeenCalled()
      expect(manager.list().map((t) => t.kind)).toEqual(['home', 'slides'])
    })

    it('closes a workbook opened by a launch link while the window was in the background', async () => {
      vi.useFakeTimers()
      try {
        // a launch link opens the copy before the window is brought forward
        shellWindow.isFocused.mockReturnValue(false)
        manager.openSheetsTab('/tmp/uniwork/Budget.xlsx')
        const tab = lastCreatedView(createSheetsView)
        shellWindow.isFocused.mockReturnValue(true)
        manager.focusActiveView()
        expect(tab.webContents.focus).toHaveBeenCalled()
        // seconds later the next spare mounts; Chromium focuses it inside
        // createSheetsView (loadURL), before any `focus` listener exists, and
        // OS keys sent to a hidden view reach no webContents at all
        tab.webContents.focus.mockClear()
        createSheetsView.mockImplementationOnce(() => {
          const view = makeFakeView()
          view.webContents.isFocused.mockReturnValue(true)
          return view
        })
        vi.advanceTimersByTime(3000)
        const spare = lastCreatedView(createSheetsView)
        expect(spare).not.toBe(tab)
        expect(tab.webContents.focus).toHaveBeenCalledTimes(1)
        // a key that reached the hidden spare anyway still closes the visible tab
        const preventDefault = press(spare.webContents, chord())
        expect(preventDefault).toHaveBeenCalledTimes(1)
        await vi.waitFor(() => expect(manager.list().map((t) => t.id)).toEqual(['home']))
      } finally {
        vi.useRealTimers()
      }
    })

    it('takes focus back from a spare that grabs it on its first load', () => {
      vi.useFakeTimers()
      try {
        manager.openSheetsTab('/tmp/uniwork/Budget.xlsx')
        const tab = lastCreatedView(createSheetsView)
        vi.advanceTimersByTime(3000)
        const spare = lastCreatedView(createSheetsView)
        tab.webContents.focus.mockClear()
        const loaded = spare.webContents.once.mock.calls.find(
          ([event]) => event === 'did-finish-load',
        )?.[1] as () => void
        spare.webContents.isFocused.mockReturnValue(true)
        loaded()
        expect(tab.webContents.focus).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('never leaves keyboard focus on a hidden tab view', () => {
      vi.useFakeTimers()
      try {
        manager.openSheetsTab()
        const hidden = lastCreatedView(createSheetsView)
        manager.openDocsTab('/tmp/report.docx')
        const active = lastCreatedView(createDocsView)
        active.webContents.focus.mockClear()
        hidden.webContents.isFocused.mockReturnValue(true)
        hidden.webContents.listeners.get('focus')!()
        // a focus() made inside Chromium's own focus change does not stick
        expect(active.webContents.focus).not.toHaveBeenCalled()
        vi.runOnlyPendingTimers()
        expect(active.webContents.focus).toHaveBeenCalledTimes(1)
        // the active view and the chrome keep the focus they take
        active.webContents.isFocused.mockReturnValue(true)
        active.webContents.listeners.get('focus')!()
        vi.runOnlyPendingTimers()
        expect(active.webContents.focus).toHaveBeenCalledTimes(1)
        expect(shellWindow.webContents.listeners.has('focus')).toBe(false)
        // a background window does not pull OS focus; its `focus` handler re-runs it
        shellWindow.isFocused.mockReturnValue(false)
        hidden.webContents.listeners.get('focus')!()
        vi.runOnlyPendingTimers()
        expect(active.webContents.focus).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('removes a clean tab and falls back to the previous tab', async () => {
    manager.openSheetsTab()
    const sheetsView = lastCreatedView(createSheetsView)
    const slidesId = manager.openSlidesTab()

    await manager.closeTab(slidesId)
    const tabs = manager.list()
    expect(tabs.map((t) => t.id)).toEqual(['home', 't1'])
    expect(tabs[1].active).toBe(true)
    expect(sheetsView.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('keeps the current tab active when closing a background tab', async () => {
    const sheetsId = manager.openSheetsTab()
    const slidesId = manager.openSlidesTab()
    await manager.closeTab(sheetsId)
    expect(manager.list().find((t) => t.id === slidesId)?.active).toBe(true)
  })

  it('detaches and destroys non-docs views on close', async () => {
    const id = manager.openSheetsTab()
    const view = lastCreatedView(createSheetsView)
    await manager.closeTab(id)
    expect(shellWindow.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(view.webContents.close).toHaveBeenCalledTimes(1)
  })

  it('tears down the docs bookkeeping, then destroys the docs renderer on close', async () => {
    const id = manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    await manager.closeTab(id)
    expect(shellWindow.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(teardownDocsRenderer).toHaveBeenCalledWith(view.webContents)
<<<<<<< ours
    // GOA9-r4-03: the orphan no longer holds the closed document and its AI chat
    expect(view.webContents.loadURL).toHaveBeenCalledWith('about:blank')
=======
    expect(view.webContents.close).toHaveBeenCalledTimes(1)
>>>>>>> theirs
  })

  it('closes a clean docs tab after the async dirty query says clean', async () => {
    const id = manager.openDocsTab()
    await manager.closeTab(id)
    expect(docsQueryDirty).toHaveBeenCalledTimes(1)
    expect(requestDocsClose).not.toHaveBeenCalled()
    expect(manager.list()).toHaveLength(1)
  })

  it('keeps a dirty docs tab open when the user cancels the close guard', async () => {
    docsQueryDirty.mockImplementation(() => Promise.resolve(true))
    requestDocsClose.mockImplementation(() => Promise.resolve(false))
    const id = manager.openDocsTab()
    await manager.closeTab(id)
    expect(requestDocsClose).toHaveBeenCalledTimes(1)
    expect(manager.list().map((t) => t.id)).toEqual(['home', id])
  })

  it('confirmCloseTabsShowing runs the prompts and removes nothing; closeTabsShowingNow then closes without asking (GOA9-r4-02)', async () => {
    docsQueryDirty.mockImplementation(() => Promise.resolve(true))
    requestDocsClose.mockImplementation(() => Promise.resolve(true))
    manager.openSheetsTab('/tmp/clean.xlsx')
    const docsId = manager.openDocsTab('/tmp/dirty.docx')
    expect(await manager.confirmCloseTabsShowing('/tmp/dirty.docx')).toBe(true)
    expect(requestDocsClose).toHaveBeenCalledTimes(1)
    expect(manager.list().map((t) => t.id)).toContain(docsId)
    manager.closeTabsShowingNow('/tmp/dirty.docx')
    manager.closeTabsShowingNow('/tmp/clean.xlsx')
    expect(requestDocsClose).toHaveBeenCalledTimes(1)
    expect(manager.list().map((t) => t.id)).toEqual(['home'])
  })

  it('confirmCloseTabsShowing is false when the user cancels, and the tab stays', async () => {
    docsQueryDirty.mockImplementation(() => Promise.resolve(true))
    requestDocsClose.mockImplementation(() => Promise.resolve(false))
    const docsId = manager.openDocsTab('/tmp/dirty.docx')
    expect(await manager.confirmCloseTabsShowing('/tmp/dirty.docx')).toBe(false)
    expect(manager.list().map((t) => t.id)).toEqual(['home', docsId])
  })

  it('activates a dirty background tab before showing its close guard', async () => {
    sheetsPendingEditCount.mockImplementation(() => 1)
    requestSheetsClose.mockImplementation(() => Promise.resolve(false))
    const sheetsId = manager.openSheetsTab()
    manager.openSlidesTab()

    await manager.closeTab(sheetsId)
    expect(requestSheetsClose).toHaveBeenCalledTimes(1)
    // the guarded tab was brought into view for the prompt
    expect(manager.list().find((t) => t.id === sheetsId)?.active).toBe(true)
  })

  it('closes a dirty sheets tab when the guard resolves true', async () => {
    sheetsPendingEditCount.mockImplementation(() => 1)
    requestSheetsClose.mockImplementation(() => Promise.resolve(true))
    const id = manager.openSheetsTab()
    await manager.closeTab(id)
    expect(manager.list()).toHaveLength(1)
  })

  it('does not stack close guards while one prompt is pending', async () => {
    sheetsPendingEditCount.mockImplementation(() => 1)
    let resolveGuard!: (ok: boolean) => void
    requestSheetsClose.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveGuard = resolve
        }),
    )
    const id = manager.openSheetsTab()
    const first = manager.closeTab(id)
    const second = manager.closeTab(id)
    resolveGuard(true)
    await Promise.all([first, second])
    expect(requestSheetsClose).toHaveBeenCalledTimes(1)
    expect(manager.list()).toHaveLength(1)
  })
})

describe('file path bookkeeping', () => {
  it('updates the tab title when a module opens a file in an existing tab', () => {
    manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    manager.setTabFileFor(view.webContents.id, '/tmp/final.docx')
    expect(manager.list()[1].title).toBe('final.docx')
    expect(manager.findDocsTabByPath('/tmp/final.docx')).toBe('t1')
  })

  it('ignores setTabFileFor for unknown webContents', () => {
    onChanged.mockClear()
    manager.setTabFileFor(999, '/tmp/x.docx')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('renames matching tabs and reports the affected views', () => {
    manager.openDocsTab('/tmp/old.docx')
    const view = lastCreatedView(createDocsView)
    const affected = manager.renameTabFile('/tmp/old.docx', '/tmp/new.docx')
    expect(affected).toEqual([{ kind: 'docs', webContents: view.webContents }])
    expect(manager.list()[1].title).toBe('new.docx')
    expect(manager.findDocsTabByPath('/tmp/new.docx')).toBe('t1')
    expect(manager.findDocsTabByPath('/tmp/old.docx')).toBeUndefined()
  })

  it('returns no affected views when nothing matches a rename', () => {
    onChanged.mockClear()
    expect(manager.renameTabFile('/tmp/none.docx', '/tmp/new.docx')).toEqual([])
    expect(onChanged).not.toHaveBeenCalled()
  })

  // F1 (S18): a document renamed on the web keeps its file name under an open
  // editor, so the tab is re-titled by path without re-keying it.
  it('re-titles an open tab by path without moving its file', () => {
    manager.openDocsTab('/tmp/Q4 plan.docx')
    const view = lastCreatedView(createDocsView)
    const affected = manager.retitleTabFile('/tmp/Q4 plan.docx', 'Q4 plan v2.docx')
    expect(affected).toEqual([{ kind: 'docs', webContents: view.webContents }])
    expect(manager.list()[1].title).toBe('Q4 plan v2.docx')
    // the path is untouched: nothing moved on disk
    expect(manager.findDocsTabByPath('/tmp/Q4 plan.docx')).toBe('t1')
  })

  it('re-titles the same path only once, and reports nothing when it matches none', () => {
    manager.openDocsTab('/tmp/Q4 plan.docx')
    expect(manager.retitleTabFile('/tmp/Q4 plan.docx', 'Q4 plan v2.docx')).toHaveLength(1)
    // the title already carries the new value: no second change, no re-render
    expect(manager.retitleTabFile('/tmp/Q4 plan.docx', 'Q4 plan v2.docx')).toEqual([])
    expect(manager.retitleTabFile('/tmp/other.docx', 'Nope.docx')).toEqual([])
  })

  /**
   * One case per TabKind a file can live in. The shell dispatches a rename to a
   * per-app hook on the kind renameTabFile reports, so a kind with no case here
   * is a kind whose editor would silently keep saving to the old path. `home`
   * carries no file, so it gets the negative case below instead of a positive
   * one.
   */
  const RENAMABLE: {
    kind: Exclude<TabKind, 'home'>
    file: string
    renamed: string
    open: () => FakeView
  }[] = [
    {
      kind: 'docs',
      file: '/tmp/one.docx',
      renamed: '/tmp/two.docx',
      open: () => {
        manager.openDocsTab('/tmp/one.docx')
        return lastCreatedView(createDocsView)
      },
    },
    {
      kind: 'sheets',
      file: '/tmp/one.xlsx',
      renamed: '/tmp/two.xlsx',
      open: () => {
        manager.openSheetsTab('/tmp/one.xlsx')
        return lastCreatedView(createSheetsView)
      },
    },
    {
      kind: 'slides',
      file: '/tmp/one.pptx',
      renamed: '/tmp/two.pptx',
      open: () => {
        manager.openSlidesTab('/tmp/one.pptx')
        return lastCreatedView(createSlidesView)
      },
    },
    {
      kind: 'pdf',
      file: '/tmp/one.pdf',
      renamed: '/tmp/two.pdf',
      open: () => {
        manager.openPdfTab('/tmp/one.pdf')
        return lastCreatedView(createPdfView)
      },
    },
    {
      kind: 'markdown',
      file: '/tmp/one.md',
      renamed: '/tmp/two.md',
      open: () => {
        manager.openMarkdownTab('/tmp/one.md')
        return lastCreatedView(createMarkdownView)
      },
    },
    {
      kind: 'html',
      file: '/tmp/one.html',
      renamed: '/tmp/two.html',
      open: () => {
        manager.openHtmlTab('/tmp/one.html')
        return lastCreatedView(createHtmlView)
      },
    },
  ]

  it.each(RENAMABLE)('a rename reports the $kind view', (c) => {
    const view = c.open()
    expect(manager.renameTabFile(c.file, c.renamed)).toEqual([
      { kind: c.kind, webContents: view.webContents },
    ])
  })

  it.each(RENAMABLE)('a rename retitles and repaths the $kind tab', (c) => {
    c.open()
    manager.renameTabFile(c.file, c.renamed)
    const tab = manager.list().find((t) => t.id === 't1')
    expect(tab?.filePath).toBe(c.renamed)
    expect(tab?.title).toBe('two' + c.file.slice(c.file.lastIndexOf('.')))
  })

  it('never claims the home tab, which has no file on disk', () => {
    const before = manager.list().map((t) => ({ id: t.id, title: t.title, filePath: t.filePath }))
    expect(before.some((t) => t.id === 'home')).toBe(true)
    expect(manager.renameTabFile('/tmp/one.docx', '/tmp/two.docx')).toEqual([])
    expect(manager.list().map((t) => ({ id: t.id, title: t.title, filePath: t.filePath }))).toEqual(
      before,
    )
  })

  it('covers every kind the manager can open', () => {
    // The table is checked against what the manager can actually produce rather
    // than a hand-written list, so a new open*Tab method cannot ship without a
    // rename case. A Record<TabKind, true> would read better, but apps/shell
    // tsconfig includes src/** only, so nothing under tests/ ever reaches the
    // typecheck CI runs.
    const openers = Object.getOwnPropertyNames(TabManager.prototype).filter((name) =>
      /^open[A-Z]\w*Tab$/.test(name),
    )
    expect(openers.length).toBeGreaterThanOrEqual(7)
    const opened: string[] = []
    for (const name of openers) {
      const before = manager.list().length
      const opener = (manager as unknown as Record<string, (arg?: unknown) => unknown>)[name]
      opener?.call(manager, '/tmp/probe.probe')
      const after = manager.list()
      if (after.length > before) opened.push(after[after.length - 1]!.kind)
    }
    // file-less tabs (the in-app manual) have no path to rename, so they are
    // opened by the enumeration but must not demand a RENAMABLE case
    const fileless = new Set(['help'])
    expect([...new Set(opened.filter((k) => !fileless.has(k)))].sort()).toEqual(
      RENAMABLE.map((c) => c.kind).sort(),
    )
  })

  it('finds tabs by kind and path', () => {
    manager.openSheetsTab('/tmp/a.xlsx')
    manager.openSlidesTab('/tmp/b.pptx')
    manager.openPdfTab('/tmp/c.pdf')
    expect(manager.findSheetsTab()).toBe('t1')
    expect(manager.findSheetsTabByPath('/tmp/a.xlsx')).toBe('t1')
    expect(manager.findSlidesTabByPath('/tmp/b.pptx')).toBe('t2')
    expect(manager.findPdfTabByPath('/tmp/c.pdf')).toBe('t3')
    expect(manager.findPdfTabByPath('/tmp/missing.pdf')).toBeUndefined()
  })

  it('finds every document family by a canonicalized path alias', () => {
    const docsId = manager.openDocsTab('/real/file')
    const sheetsId = manager.openSheetsTab('/real/file')
    const slidesId = manager.openSlidesTab('/real/file')
    const pdfId = manager.openPdfTab('/real/file')
    // markdown/html view factories need electron protocol mocks the shell
    // suite does not provide, so seed their tab records directly: the
    // finders only read kind/view/filePath.
    const seedTab = (kind: string, filePath: string) => {
      const tabs = (
        manager as unknown as {
          tabs: Array<{ id: string; kind: string; view: unknown; filePath: string }>
        }
      ).tabs
      const id = `seed-${kind}`
      tabs.push({ id, kind, view: {}, filePath })
      return id
    }
    const markdownId = seedTab('markdown', '/real/file')
    const htmlId = seedTab('html', '/real/file')

    expect(manager.findDocsTabByPath('/canonical/file')).toBe(docsId)
    expect(manager.findSheetsTabByPath('/REAL/FILE')).toBe(sheetsId)
    expect(manager.findSlidesTabByPath('/canonical/file')).toBe(slidesId)
    expect(manager.findPdfTabByPath('/REAL/FILE')).toBe(pdfId)
    expect(manager.findMarkdownTabByPath('/canonical/file')).toBe(markdownId)
    expect(manager.findHtmlTabByPath('/REAL/FILE')).toBe(htmlId)
    expect(manager.findDocsTabByPath('/missing')).toBeUndefined()
    expect(manager.findDocsTabByPath()).toBeUndefined()
  })

  it('reloads an existing pdf tab so a re-export rereads the file from disk', () => {
    const id = manager.openPdfTab('/tmp/c.pdf')
    const view = lastCreatedView(createPdfView)
    manager.reloadTab(id)
    expect(clearPdfDirty).toHaveBeenCalledWith(view.webContents.id)
    expect(view.webContents.reload).toHaveBeenCalledTimes(1)
  })

  it('reloading a docs tab queues its document again (the reloaded renderer opens it)', () => {
    const id = manager.openDocsTab('/tmp/report.docx')
    const view = lastCreatedView(createDocsView)
    queueDocsForView.mockClear()
    manager.reloadTab(id)
    expect(queueDocsForView).toHaveBeenCalledWith(view.webContents, '/tmp/report.docx')
    expect(queueDocsForView.mock.invocationCallOrder[0]).toBeLessThan(
      view.webContents.reload.mock.invocationCallOrder[0]!,
    )
    expect(view.webContents.reload).toHaveBeenCalledTimes(1)
  })

  it('reloading an untitled docs tab queues nothing', () => {
    const id = manager.openDocsTab()
    queueDocsForView.mockClear()
    manager.reloadTab(id)
    expect(queueDocsForView).not.toHaveBeenCalled()
  })

  it('reloading a sheets tab queues its workbook again (the reloaded renderer opens it)', () => {
    const id = manager.openSheetsTab('/tmp/book.xlsx')
    const view = lastCreatedView(createSheetsView)
    queueWorkbookForView.mockClear()
    manager.reloadTab(id)
    expect(queueWorkbookForView).toHaveBeenCalledWith(view.webContents, '/tmp/book.xlsx')
    expect(queueWorkbookForView.mock.invocationCallOrder[0]).toBeLessThan(
      view.webContents.reload.mock.invocationCallOrder[0]!,
    )
    expect(view.webContents.reload).toHaveBeenCalledTimes(1)
  })

  it('reloading an untitled sheets tab queues nothing', () => {
    const id = manager.openSheetsTab()
    queueWorkbookForView.mockClear()
    manager.reloadTab(id)
    expect(queueWorkbookForView).not.toHaveBeenCalled()
  })

  it('reloading a slides tab queues its deck again (the reloaded renderer opens it)', () => {
    const id = manager.openSlidesTab('/tmp/deck.pptx')
    const view = lastCreatedView(createSlidesView)
    queueSlidesForView.mockClear()
    manager.reloadTab(id)
    expect(queueSlidesForView).toHaveBeenCalledWith(view.webContents, '/tmp/deck.pptx')
    expect(queueSlidesForView.mock.invocationCallOrder[0]).toBeLessThan(
      view.webContents.reload.mock.invocationCallOrder[0]!,
    )
    expect(view.webContents.reload).toHaveBeenCalledTimes(1)
  })

  it('reloading an untitled slides tab queues nothing', () => {
    const id = manager.openSlidesTab()
    queueSlidesForView.mockClear()
    manager.reloadTab(id)
    expect(queueSlidesForView).not.toHaveBeenCalled()
  })

  it('reports the active pdf tab with its id (so callers can re-activate it)', () => {
    const pdfId = manager.openPdfTab('/tmp/c.pdf')
    const active = manager.activePdfTab()
    expect(active?.id).toBe(pdfId)
    expect(active?.filePath).toBe('/tmp/c.pdf')
    manager.openDocsTab()
    expect(manager.activePdfTab()).toBeUndefined()
  })
})

/** the live view of the tab showing `path` */
function viewOfPath(path: string): FakeView {
  const tabs = (manager as unknown as { tabs: Array<{ filePath?: string; view?: FakeView }> }).tabs
  return tabs.find((t) => t.filePath === path)!.view!
}

describe('dirty-tab queries (shell close guard)', () => {
  it('lists only tabs whose module reports unsaved changes', () => {
    const dirtySheetsId = manager.openSheetsTab()
    const dirtyView = lastCreatedView(createSheetsView)
    manager.openSheetsTab()
    sheetsPendingEditCount.mockImplementation((id: number) =>
      id === dirtyView.webContents.id ? 3 : 0,
    )

    const dirty = manager.dirtySheetsTabs()
    expect(dirty).toEqual([{ id: dirtySheetsId, webContents: dirtyView.webContents }])
  })

  it('lists dirty pdf and slides tabs', () => {
    const pdfId = manager.openPdfTab('/tmp/c.pdf')
    const slidesId = manager.openSlidesTab()
    expect(manager.dirtyPdfTabs()).toEqual([])
    expect(manager.dirtySlidesTabs()).toEqual([])
    pdfIsDirty.mockImplementation(() => true)
    slidesIsDirty.mockImplementation(() => true)
    expect(manager.dirtyPdfTabs().map((t) => t.id)).toEqual([pdfId])
    expect(manager.dirtySlidesTabs().map((t) => t.id)).toEqual([slidesId])
  })

  it('reports the editor state of the tabs showing wanted files (the UniWork chip)', async () => {
    manager.openDocsTab('/uw/a.docx')
    manager.openMarkdownTab('/uw/b.md')
    manager.openPdfTab('/local/c.pdf')
    manager.openDocsTab()
    docsQueryEditorDirty.mockImplementation(() => Promise.resolve(null))
    markdownIsDirty.mockImplementation(() => true)
    const states = await manager.editorDirtyStates((path) => path.startsWith('/uw/'))
    expect(states).toEqual([
      { path: '/uw/a.docx', dirty: null, aiRunning: false, aiEpoch: 0 },
      { path: '/uw/b.md', dirty: true, aiRunning: false, aiEpoch: 0 },
    ])
    expect(pdfIsDirty).not.toHaveBeenCalled()
    markdownIsDirty.mockImplementation(() => false)
    docsQueryEditorDirty.mockImplementation(() => Promise.resolve(false))
  })

  it('reports aiRunning for every editor kind from the AI run registry', async () => {
    const opened: Array<[string, FakeView]> = []
    manager.openDocsTab('/uw/a.docx')
    opened.push(['/uw/a.docx', lastCreatedView(createDocsView)])
    manager.openSheetsTab('/uw/b.xlsx')
    opened.push(['/uw/b.xlsx', viewOfPath('/uw/b.xlsx')])
    manager.openSlidesTab('/uw/c.pptx')
    opened.push(['/uw/c.pptx', viewOfPath('/uw/c.pptx')])
    manager.openPdfTab('/uw/d.pdf')
    opened.push(['/uw/d.pdf', viewOfPath('/uw/d.pdf')])
    manager.openMarkdownTab('/uw/e.md')
    opened.push(['/uw/e.md', viewOfPath('/uw/e.md')])
    manager.openHtmlTab('/uw/f.html')
    opened.push(['/uw/f.html', viewOfPath('/uw/f.html')])
    for (const [, view] of opened) noteAiRun(view.webContents as never, { state: 'running' })
    const states = await manager.editorDirtyStates((path) => path.startsWith('/uw/'))
    expect(states.map((s) => [s.path, s.aiRunning])).toEqual(opened.map(([p]) => [p, true]))
    noteAiRun(opened[3][1].webContents as never, { state: 'idle' })
    const after = await manager.editorDirtyStates((path) => path.startsWith('/uw/'))
    expect(after.find((s) => s.path === '/uw/d.pdf')?.aiRunning).toBe(false)
  })

  it('a crashed renderer (render-process-gone) reads aiRunning false', async () => {
    manager.openDocsTab('/uw/a.docx')
    const view = lastCreatedView(createDocsView)
    noteAiRun(view.webContents as never, { state: 'running', runId: 'turn-1' })
    expect((await manager.editorDirtyStates(() => true))[0].aiRunning).toBe(true)
    view.webContents.listeners.get('render-process-gone')!()
    // the flag goes with the crashed renderer; the epoch is not rolled back
    expect(await manager.editorDirtyStates(() => true)).toEqual([
      { path: '/uw/a.docx', dirty: false, aiRunning: false, aiEpoch: 1 },
    ])
  })

  it('a tab closed mid-run (even while its dirty query yields) reads aiRunning false', async () => {
    const id = manager.openDocsTab('/uw/a.docx')
    const view = lastCreatedView(createDocsView)
    noteAiRun(view.webContents as never, { state: 'running', runId: 'turn-1' })
    let answer: (dirty: boolean) => void = () => undefined
    docsQueryEditorDirty.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const pending = manager.editorDirtyStates(() => true)
    manager.closeTabWithoutPrompt(id)
    answer(false)
    expect(await pending).toEqual([
      { path: '/uw/a.docx', dirty: false, aiRunning: false, aiEpoch: 0 },
    ])
    expect(await manager.editorDirtyStates(() => true)).toEqual([])
    docsQueryEditorDirty.mockImplementation(() => Promise.resolve(false))
  })

  it('a closed docs tab (blanked, not destroyed) reads aiRunning false', async () => {
    const id = manager.openDocsTab('/uw/a.docx')
    const view = lastCreatedView(createDocsView)
    noteAiRun(view.webContents as never, { state: 'running', runId: 'turn-1' })
    expect((await manager.editorDirtyStates(() => true))[0].aiRunning).toBe(true)
    expect(manager.closeTabWithoutPrompt(id)).toBe(true)
    // the docs teardown path blanks the page and keeps the webContents alive,
    // so the shell must drop the turn itself
    expect(teardownDocsRenderer).toHaveBeenCalledWith(view.webContents)
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(isAiRunning(view.webContents.id)).toBe(false)
    expect(await manager.editorDirtyStates(() => true)).toEqual([])
  })

  it('a Present tab adds no entry; its owner tab reports the run', async () => {
    manager.openHtmlTab('/uw/f.html')
    const owner = viewOfPath('/uw/f.html')
    manager.openHtmlPresentTab(owner.webContents as never, 'Preview')
    noteAiRun(owner.webContents as never, { state: 'running' })
    expect(await manager.editorDirtyStates(() => true)).toEqual([
      { path: '/uw/f.html', dirty: false, aiRunning: true, aiEpoch: 1 },
    ])
  })

  it("a present view's AI turn is attributed to its owner's document", async () => {
    manager.openHtmlTab('/uw/f.html')
    const owner = viewOfPath('/uw/f.html')
    manager.openHtmlPresentTab(owner.webContents as never, 'Preview')
    const present = lastCreatedView(createHtmlPresentView)
    // the present view alone runs: the document is busy
    noteAiRun(present.webContents as never, { state: 'running', runId: 'present-1' })
    expect(await manager.editorDirtyStates(() => true)).toEqual([
      { path: '/uw/f.html', dirty: false, aiRunning: true, aiEpoch: 1 },
    ])
    // both views run: the epochs add up, so a turn on either is visible
    noteAiRun(owner.webContents as never, { state: 'running', runId: 'owner-1' })
    expect(await manager.editorDirtyStates(() => true)).toEqual([
      { path: '/uw/f.html', dirty: false, aiRunning: true, aiEpoch: 2 },
    ])
    // closing the present tab mid-turn clears its flag
    const presentId = manager.tabIdForWebContents(present.webContents.id)!
    await manager.closeTab(presentId)
    expect(isAiRunning(present.webContents.id)).toBe(false)
    expect(await manager.editorDirtyStates(() => true)).toEqual([
      { path: '/uw/f.html', dirty: false, aiRunning: true, aiEpoch: 1 },
    ])
  })

  it('lists every live docs tab for the async dirtiness sweep', () => {
    manager.openDocsTab()
    manager.openSheetsTab()
    manager.openDocsTab('/tmp/a.docx')
    expect(manager.docsTabs().map((t) => t.id)).toEqual(['t1', 't3'])
  })
})

describe('detach / attach (Open in New Window, tear-off, dock)', () => {
  it('lifts a tab out without closing its renderer and hands the live view back', () => {
    manager.openDocsTab('/tmp/a.docx')
    const id = manager.openPdfTab('/tmp/scan.pdf')
    const view = lastCreatedView(createPdfView)
    const record = manager.detachTab(id)
    expect(record).toMatchObject({ kind: 'pdf', title: 'scan.pdf', filePath: '/tmp/scan.pdf' })
    expect(record!.view).toBe(view)
    expect(shellWindow.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(manager.list().map((t) => t.id)).toEqual(['home', 't1'])
    expect(manager.list()[1].active).toBe(true)
  })

  it('every document kind can be detached; Home and Present tabs cannot', () => {
    const docs = manager.openDocsTab()
    const sheets = manager.openSheetsTab()
    const slides = manager.openSlidesTab()
    const pdf = manager.openPdfTab('/tmp/scan.pdf')
    const markdown = manager.openMarkdownTab()
    const html = manager.openHtmlTab()
    const present = manager.openHtmlPresentTab({ id: 999 } as never, 'Preview')
    for (const id of [docs, sheets, slides, pdf, markdown, html])
      expect(manager.canDetachTab(id)).toBe(true)
    expect(manager.canDetachTab('home')).toBe(false)
    expect(manager.canDetachTab(present)).toBe(false)
    expect(manager.canDetachTab('nope')).toBe(false)
    expect(manager.detachTab(present)).toBeNull()
  })

  it('attaches a view back as a new, active tab at the requested slot', () => {
    manager.openDocsTab('/tmp/a.docx')
    manager.openDocsTab('/tmp/b.docx')
    const id = manager.openSlidesTab('/tmp/deck.pptx')
    const record = manager.detachTab(id)!
    shellWindow.contentView.addChildView.mockClear()

    const newId = manager.attachTab(record, 1)
    expect(newId).not.toBe(id)
    expect(shellWindow.contentView.addChildView).toHaveBeenCalledWith(record.view)
    expect(record.view.setVisible).toHaveBeenLastCalledWith(true)
    expect(record.view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })
    expect(manager.list().map((t) => [t.id, t.title, t.active])).toEqual([
      ['home', 'UniWork Office', false],
      [newId, 'deck.pptx', true],
      ['t1', 'a.docx', false],
      ['t2', 'b.docx', false],
    ])
    expect(setActiveSlidesWebContents).toHaveBeenLastCalledWith(record.view.webContents)
    expect(applyMenuFor).toHaveBeenLastCalledWith('slides')
  })

  it('keeps Home pinned: slot 0 and negative slots land right after it, out-of-range appends', () => {
    manager.openDocsTab('/tmp/a.docx')
    const first = manager.detachTab(manager.openSheetsTab('/tmp/x.xlsx'))!
    const second = manager.detachTab(manager.openSheetsTab('/tmp/y.xlsx'))!
    const third = manager.detachTab(manager.openSheetsTab('/tmp/z.xlsx'))!
    manager.attachTab(first, 0)
    expect(manager.list().map((t) => t.title)).toEqual(['UniWork Office', 'x.xlsx', 'a.docx'])
    manager.attachTab(second, -4)
    expect(manager.list().map((t) => t.title)).toEqual([
      'UniWork Office',
      'y.xlsx',
      'x.xlsx',
      'a.docx',
    ])
    manager.attachTab(third, 99)
    expect(manager.list().map((t) => t.title)).toEqual([
      'UniWork Office',
      'y.xlsx',
      'x.xlsx',
      'a.docx',
      'z.xlsx',
    ])
  })

  it('appends when no slot is given', () => {
    manager.openDocsTab('/tmp/a.docx')
    const record = manager.detachTab(manager.openPdfTab('/tmp/scan.pdf'))!
    manager.openDocsTab('/tmp/b.docx')
    manager.attachTab(record)
    expect(manager.list().map((t) => t.title)).toEqual([
      'UniWork Office',
      'a.docx',
      'b.docx',
      'scan.pdf',
    ])
  })

  it('installs the HTML-fullscreen listeners once per view across detach and re-attach', () => {
    const id = manager.openSlidesTab('/tmp/deck.pptx')
    const view = lastCreatedView(createSlidesView)
    const fullScreenRegistrations = () =>
      view.webContents.on.mock.calls.filter(([event]) => event === 'enter-html-full-screen').length
    expect(fullScreenRegistrations()).toBe(1)
    const record = manager.detachTab(id)!
    const newId = manager.attachTab(record)
    expect(fullScreenRegistrations()).toBe(1)

    // the listener resolves the *current* id: fullscreen after re-attach covers the strip
    view.webContents.listeners.get('enter-html-full-screen')!()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    })
    view.webContents.listeners.get('leave-html-full-screen')!()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })
    expect(manager.list()[1].id).toBe(newId)
  })

  it('a re-attached docs tab closes through the docs teardown path like any docs tab', async () => {
    const record = manager.detachTab(manager.openDocsTab('/tmp/a.docx'))!
    const newId = manager.attachTab(record)
    await manager.closeTab(newId)
    expect(teardownDocsRenderer).toHaveBeenCalledWith(record.view.webContents)
    expect(record.view.webContents.close).toHaveBeenCalledTimes(1)
    expect(manager.list()).toHaveLength(1)
  })
})

<<<<<<< ours
describe('the Discussion panel narrows the active editor view (G8-11 D1)', () => {
  const full = {
    x: 0,
    y: TAB_STRIP_HEIGHT,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
  }

  it('takes the clamped panel width off the right edge and restores it on close', () => {
    manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    manager.setDiscussionPanel({ open: true, width: 320 })
    expect(view.setBounds).toHaveBeenLastCalledWith({ ...full, width: WINDOW_WIDTH - 320 })
    // wider than the window allows: the editor keeps its minimum (800 - 360)
    manager.setDiscussionPanel({ open: true, width: 1000 })
    expect(view.setBounds).toHaveBeenLastCalledWith({ ...full, width: 360 })
    // narrower than the panel minimum: clamped up to 280
    manager.setDiscussionPanel({ open: true, width: 10 })
    expect(view.setBounds).toHaveBeenLastCalledWith({ ...full, width: WINDOW_WIDTH - 280 })
    manager.setDiscussionPanel({ open: false, width: 320 })
    expect(view.setBounds).toHaveBeenLastCalledWith(full)
  })

  // R1-3: the panel reports window pixels and the renderer divides its box by --ui-scale, so main
  // frees the same width at any interface scale (only the tab strip height follows the scale).
  it('frees the reported window-pixel width at interface scale 1.5', () => {
    manager = new TabManager(
      shellWindow as never,
      () => onChanged(),
      (kind) => applyMenuFor(kind),
      undefined,
      () => 1.5,
    )
    manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    manager.setDiscussionPanel({ open: true, width: 320 })
    const strip = tabStripHeight(1.5)
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: strip,
      width: WINDOW_WIDTH - 320,
      height: WINDOW_HEIGHT - strip,
    })
  })

  it('re-applies on tab switch and on window resize', () => {
    const docsId = manager.openDocsTab()
    const docsView = lastCreatedView(createDocsView)
    manager.openSheetsTab()
    const sheetsView = lastCreatedView(createSheetsView)
    manager.setDiscussionPanel({ open: true, width: 300 })
    expect(sheetsView.setBounds).toHaveBeenLastCalledWith({ ...full, width: WINDOW_WIDTH - 300 })
    manager.activateTab(docsId)
    expect(docsView.setBounds).toHaveBeenLastCalledWith({ ...full, width: WINDOW_WIDTH - 300 })

    shellWindow.getContentBounds = () => ({ x: 0, y: 0, width: 1200, height: WINDOW_HEIGHT })
    manager.layout()
    expect(docsView.setBounds).toHaveBeenLastCalledWith({ ...full, width: 1200 - 300 })
    // a narrow window: the editor keeps its 360 minimum, the panel shrinks
    shellWindow.getContentBounds = () => ({ x: 0, y: 0, width: 500, height: WINDOW_HEIGHT })
    manager.layout()
    expect(docsView.setBounds).toHaveBeenLastCalledWith({ ...full, width: 360 })
  })

  it('a full-bleed view (slideshow, HTML fullscreen) ignores the panel', () => {
    manager.openSlidesTab()
    const view = lastCreatedView(createSlidesView)
    manager.setDiscussionPanel({ open: true, width: 320 })
    view.webContents.listeners.get('enter-html-full-screen')!()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    })
  })

  it('bounds are computed for the tab being shown, not the one being left (W11A-3)', () => {
    manager.openSlidesTab()
    const slidesId = manager.list().find((t) => t.kind === 'slides')!.id
    const slides = lastCreatedView(createSlidesView)
    const docsId = manager.openDocsTab()
    const docs = lastCreatedView(createDocsView)
    manager.activateTab(slidesId)
    manager.setDiscussionPanel({ open: true, width: 320 })
    slides.webContents.listeners.get('enter-html-full-screen')!()
    const bleed = { x: 0, y: 0, width: WINDOW_WIDTH, height: WINDOW_HEIGHT }
    expect(slides.setBounds).toHaveBeenLastCalledWith(bleed)
    // leaving the slideshow tab: the new view is narrowed by the open panel and
    // sits under the tab strip, not full-window
    manager.activateTab(docsId)
    expect(docs.setBounds).toHaveBeenLastCalledWith({ ...full, width: WINDOW_WIDTH - 320 })
    // coming back to the slideshow tab: full-bleed again, the panel is ignored
    manager.activateTab(slidesId)
    expect(slides.setBounds).toHaveBeenLastCalledWith(bleed)
  })

  it('a malformed width closes nothing open by accident and narrows nothing', () => {
    manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    manager.setDiscussionPanel({ open: true, width: Number.NaN })
    expect(view.setBounds).toHaveBeenLastCalledWith(full)
  })
})

describe('the S6 bar inset moves the active editor view down (G5-03a)', () => {
  const withInset = (inset: number) => ({
    x: 0,
    y: TAB_STRIP_HEIGHT + inset,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT - inset,
  })

  it('insets the active view under the tab strip and restores it at 0', () => {
    manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    manager.setTopInset(36)
    expect(view.setBounds).toHaveBeenLastCalledWith(withInset(36))
    // a bar that hides reports 0: the view takes the tab strip height again
    manager.setTopInset(0)
    expect(view.setBounds).toHaveBeenLastCalledWith(withInset(0))
  })

  it('clamps the inset to 0..400 and rounds to an integer', () => {
    manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    manager.setTopInset(-20)
    expect(view.setBounds).toHaveBeenLastCalledWith(withInset(0))
    // the S6 bar plus an open queue popover passes 200 (G5-06u)
    manager.setTopInset(260)
    expect(view.setBounds).toHaveBeenLastCalledWith(withInset(260))
    manager.setTopInset(9999)
    expect(view.setBounds).toHaveBeenLastCalledWith(withInset(400))
    manager.setTopInset(42.6)
    expect(view.setBounds).toHaveBeenLastCalledWith(withInset(43))
    // a non-finite height moves nothing
    manager.setTopInset(Number.NaN)
    expect(view.setBounds).toHaveBeenLastCalledWith(withInset(43))
  })

  it('re-applies on tab switch and on window resize', () => {
    const docsId = manager.openDocsTab()
    const docs = lastCreatedView(createDocsView)
    manager.openSheetsTab()
    const sheets = lastCreatedView(createSheetsView)
    manager.setTopInset(40)
    expect(sheets.setBounds).toHaveBeenLastCalledWith(withInset(40))
    manager.activateTab(docsId)
    expect(docs.setBounds).toHaveBeenLastCalledWith(withInset(40))
    shellWindow.getContentBounds = () => ({ x: 0, y: 0, width: WINDOW_WIDTH, height: 1080 })
    manager.layout()
    expect(docs.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TAB_STRIP_HEIGHT + 40,
      width: WINDOW_WIDTH,
      height: 1080 - TAB_STRIP_HEIGHT - 40,
    })
  })

  it('combines with the Discussion panel and is ignored by a full-bleed view', () => {
    manager.openDocsTab()
    const docs = lastCreatedView(createDocsView)
    manager.setTopInset(40)
    manager.setDiscussionPanel({ open: true, width: 320 })
    expect(docs.setBounds).toHaveBeenLastCalledWith({
      ...withInset(40),
      width: WINDOW_WIDTH - 320,
    })
    manager.openSlidesTab()
    const slides = lastCreatedView(createSlidesView)
    slides.webContents.listeners.get('enter-html-full-screen')!()
    expect(slides.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    })
  })

  it('scales the CSS-px inset at interface scale 1.5 and re-layouts on a scale change without a new report (R4-2, R4-5)', () => {
    let scale = 1.5
    manager = new TabManager(
      shellWindow as never,
      () => onChanged(),
      (kind) => applyMenuFor(kind),
      undefined,
      () => scale,
    )
    manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    manager.setTopInset(40)
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 60 + 60,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT - 120,
    })
    // a scale change triggers layout() only, without a new bar report
    scale = 1
    manager.layout()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TAB_STRIP_HEIGHT + 40,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT - 40,
    })
  })
})

describe('tab title decoration (UNI-2033)', () => {
  const decorated = () =>
    new TabManager(
      shellWindow as never,
      () => onChanged(),
      (kind) => applyMenuFor(kind),
      undefined,
      () => 1,
      () => false,
      (filePath, title) => (filePath?.includes('@v2') ? `${title} · v2` : title),
    )

  it('list() shows the decorated title; the stored title stays the file name', () => {
    manager = decorated()
    manager.openDocsTab('/store/DOC@v2/Plan.docx')
    const docsView = lastCreatedView(createDocsView)
    manager.openSheetsTab('/store/DOC/Budget.xlsx')
    expect(manager.list().map((t) => t.title)).toEqual([
      'UniWork Office',
      'Plan.docx · v2',
      'Budget.xlsx',
    ])
    // the stored title stays the raw file name, so renames and re-titles work on it
    expect(manager.describeWebContents(docsView.webContents.id)?.title).toBe('Plan.docx')
  })

  it('a rename keeps following the decoration of the new path', () => {
    manager = decorated()
    manager.openDocsTab('/store/DOC/Plan.docx')
    manager.renameTabFile('/store/DOC/Plan.docx', '/store/DOC@v2/Plan.docx')
    expect(manager.list()[1]?.title).toBe('Plan.docx · v2')
  })

  it('without a decorator the titles are untouched', () => {
    manager.openDocsTab('/store/DOC@v2/Plan.docx')
    expect(manager.list()[1]?.title).toBe('Plan.docx')
=======
describe('tab sleep (background renderers released to free memory)', () => {
  const policy = { maxLiveTabs: 2, idleMs: 1000 }
  const IDLE = 5000

  function openDocs(path: string): string {
    return manager.openDocsTab(path)
  }

  it('sleeps the oldest idle background tab once more than maxLiveTabs are live', async () => {
    const a = openDocs('/a.docx')
    const b = openDocs('/b.docx')
    const c = openDocs('/c.docx')
    const viewA = createDocsView.mock.results[0]!.value as FakeView
    const slept = await manager.sleepIdleTabs(policy, Date.now() + IDLE)
    expect(slept).toEqual([a])
    expect(shellWindow.contentView.removeChildView).toHaveBeenCalledWith(viewA)
    expect(teardownDocsRenderer).toHaveBeenCalledWith(viewA.webContents)
    expect(viewA.webContents.close).toHaveBeenCalledTimes(1)
    const list = manager.list()
    expect(list.find((t) => t.id === a)?.dormant).toBe(true)
    expect(list.find((t) => t.id === b)?.dormant).toBeUndefined()
    expect(list.find((t) => t.id === c)?.active).toBe(true)
  })

  it('leaves everything alone while the live count is within the cap', async () => {
    openDocs('/a.docx')
    openDocs('/b.docx')
    expect(await manager.sleepIdleTabs(policy, Date.now() + IDLE)).toEqual([])
  })

  it('does not sleep a tab that has not been idle long enough', async () => {
    openDocs('/a.docx')
    openDocs('/b.docx')
    openDocs('/c.docx')
    expect(await manager.sleepIdleTabs(policy, Date.now())).toEqual([])
  })

  it('never sleeps the active, pinned, dirty or untitled tab', async () => {
    const a = openDocs('/a.docx')
    const b = openDocs('/b.docx')
    const untitled = manager.openDocsTab()
    openDocs('/d.docx')
    manager.setPinned(a, true)
    docsQueryDirty.mockImplementation((wc: { id: number }) =>
      Promise.resolve(wc.id === (createDocsView.mock.results[1]!.value as FakeView).webContents.id),
    )
    const slept = await manager.sleepIdleTabs({ maxLiveTabs: 1, idleMs: 0 }, Date.now() + IDLE)
    expect(slept).toEqual([])
    expect(manager.list().filter((t) => t.dormant)).toHaveLength(0)
    expect([a, b, untitled].every((id) => manager.list().some((t) => t.id === id))).toBe(true)
  })

  it('over the memory budget the oldest candidate sleeps even inside the cap', async () => {
    const a = openDocs('/a.docx')
    openDocs('/b.docs')
    const slept = await manager.sleepIdleTabs({ maxLiveTabs: 10, idleMs: 60_000 }, Date.now(), true)
    expect(slept).toEqual([a])
  })

  it('activating a sleeping tab rebuilds its view from the file, in place', async () => {
    const a = openDocs('/a.docx')
    openDocs('/b.docx')
    openDocs('/c.docx')
    await manager.sleepIdleTabs(policy, Date.now() + IDLE)
    createDocsView.mockClear()
    shellWindow.contentView.addChildView.mockClear()
    manager.activateTab(a)
    expect(createDocsView).toHaveBeenCalledWith('/a.docx')
    const revived = lastCreatedView(createDocsView)
    expect(shellWindow.contentView.addChildView).toHaveBeenCalledWith(revived)
    expect(revived.setVisible).toHaveBeenLastCalledWith(true)
    const tab = manager.list().find((t) => t.id === a)
    expect(tab).toMatchObject({ active: true, filePath: '/a.docx' })
    expect(tab?.dormant).toBeUndefined()
    expect(manager.list().map((t) => t.id)).toEqual([
      'home',
      a,
      expect.any(String),
      expect.any(String),
    ])
  })

  it('a sleeping sheets tab wakes with its workbook queued for the new view', async () => {
    const a = manager.openSheetsTab('/a.xlsx')
    manager.openSheetsTab('/b.xlsx')
    manager.openSheetsTab('/c.xlsx')
    await manager.sleepIdleTabs(policy, Date.now() + IDLE)
    queueWorkbookForView.mockClear()
    manager.activateTab(a)
    const revived = lastCreatedView(createSheetsView)
    expect(queueWorkbookForView).toHaveBeenCalledWith(revived.webContents, '/a.xlsx')
  })

  it('a dirty tab is skipped by the sweep so the clean tabs behind it still sleep', async () => {
    const a = openDocs('/a.docx')
    const b = openDocs('/b.docx')
    openDocs('/c.docx')
    const viewA = createDocsView.mock.results[0]!.value as FakeView
    docsQueryDirty.mockImplementation((wc: { id: number }) =>
      Promise.resolve(wc.id === viewA.webContents.id),
    )
    expect(await manager.sleepIdleTabs({ maxLiveTabs: 10, idleMs: 0 }, Date.now(), true)).toEqual([
      b,
    ])
    expect(manager.list().find((t) => t.id === a)?.dormant).toBeUndefined()
  })

  it('asking a sleeping tab for its webContents (agents, CLI) wakes it in the background', async () => {
    const a = openDocs('/a.docx')
    openDocs('/b.docx')
    const c = openDocs('/c.docx')
    await manager.sleepIdleTabs(policy, Date.now() + IDLE)
    createDocsView.mockClear()
    const wc = manager.webContentsForTab(a)
    expect(createDocsView).toHaveBeenCalledWith('/a.docx')
    expect(wc).toBe(lastCreatedView(createDocsView).webContents)
    expect(manager.list().find((t) => t.id === a)).toMatchObject({ active: false })
    expect(manager.list().find((t) => t.id === a)?.dormant).toBeUndefined()
    expect(manager.list().find((t) => t.id === c)?.active).toBe(true)
    expect(lastCreatedView(createDocsView).setVisible).toHaveBeenLastCalledWith(false)
    // a freshly woken tab is not put straight back to sleep by the next sweep
    expect(await manager.sleepIdleTabs(policy, Date.now())).toEqual([])
  })

  it('findTabByPath wakes a sleeping tab and returns its new webContents', async () => {
    const a = openDocs('/a.docx')
    openDocs('/b.docx')
    openDocs('/c.docx')
    await manager.sleepIdleTabs(policy, Date.now() + IDLE)
    const found = manager.findTabByPath('/a.docx')
    expect(found?.id).toBe(a)
    expect(found?.webContents).toBe(lastCreatedView(createDocsView).webContents)
  })

  it('renaming the file behind a sleeping tab updates the strip', async () => {
    const a = openDocs('/a.docx')
    openDocs('/b.docx')
    openDocs('/c.docx')
    await manager.sleepIdleTabs(policy, Date.now() + IDLE)
    onChanged.mockClear()
    expect(manager.renameTabFile('/a.docx', '/renamed.docx')).toEqual([])
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(manager.list().find((t) => t.id === a)).toMatchObject({
      title: 'renamed.docx',
      filePath: '/renamed.docx',
    })
  })

  it('a sleeping tab still counts as the open tab for its path, closes without a prompt and is listed for agents', async () => {
    const a = openDocs('/a.docx')
    openDocs('/b.docx')
    openDocs('/c.docx')
    await manager.sleepIdleTabs(policy, Date.now() + IDLE)
    expect(manager.findDocsTabByPath('/a.docx')).toBe(a)
    expect(manager.openFilePaths()).toContain('/a.docx')
    expect(manager.canDetachTab(a)).toBe(false)
    const docs = await manager.openDocuments()
    expect(docs.find((d) => d.id === a)).toMatchObject({ filePath: '/a.docx', dirty: false })
    docsQueryDirty.mockClear()
    await manager.closeTab(a)
    expect(docsQueryDirty).not.toHaveBeenCalled()
    expect(manager.list().some((t) => t.id === a)).toBe(false)
>>>>>>> theirs
  })
})
