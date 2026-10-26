import { basename, join } from 'node:path'
import { realpathSync } from 'node:fs'
<<<<<<< ours
import { BrowserWindow } from 'electron'
import type { Rectangle, WebContents, WebContentsView } from 'electron'
import {
  confirmUniworkClose,
  isUniworkCloseGuarded,
  notePathsDropped,
  uniworkNeedsClosePrompt,
} from './uniwork-docs/close-guard'
=======
import { app, BrowserWindow, shell, WebContentsView } from 'electron'
import type { Rectangle, WebContents } from 'electron'
>>>>>>> theirs

import {
  createDocsView,
  docsQueryDirty,
  docsQueryEditorDirty,
  markDocsNewBlank,
  queueDocsAiContent,
  queueDocsAiPreset,
  requestDocsClose,
  setActiveDocsResolver,
  teardownDocsRenderer,
} from '../../../docs/src/main/docs-main'
import type { AiDocContent, AiPresetPayload } from '../../../docs/src/shared/ipc'
import {
  createMarkdownView,
  markdownIsDirty,
  requestMarkdownClose,
} from '../../../markdown/src/main/markdown-main'
import {
  createHtmlPresentView,
  createHtmlView,
  htmlIsDirty,
  requestHtmlClose,
} from '../../../html/src/main/html-main'
import {
  createPdfView,
  pdfIsDirty,
  queuePdfAiPreset,
  requestPdfClose,
  type PdfAiPresetPayload,
} from '../../../pdf/src/main/pdf-main'
import {
  createSheetsView,
  nudgeQueuedWorkbook,
  queueSheetsAiPreset,
  queueWorkbookForView,
  requestSheetsClose,
  setActiveSheetsWebContents,
  setSheetsNewBlank,
  sheetsPendingEditCount,
  type SheetsAiPresetPayload,
} from '../../../sheets/src/main/sheets-main'
import {
  createSlidesView,
  queueSlidesAiPreset,
  type SlidesAiPresetPayload,
  requestSlidesClose,
  setActiveSlidesWebContents,
  slidesIsDirty,
} from '../../../slides/src/main/slides-main'
import { rendererUrl, safeExternalUrl } from '@genoffice/electron-utils'
import type { DocumentTabKind, OpenDocumentTab, TabKind, TabSummary } from '../shared/tabs-api'
<<<<<<< ours
import { tabStripHeight } from '../shared/tab-drag-geometry'
import { clampDiscussionPanelWidth } from '@genoffice/electron-utils/comments-ipc'
import { aiEpochOf, clearAiRun, isAiRunning, type EditorState } from './ai-run-registry'
import { matchShellKey, shortcutPlatform } from './shell-shortcuts'
import { blankRetiredPage } from './retire-page'
import { reloadViewFromDisk } from './reload-view'
=======
import { isSettledRect, tabStripHeight } from '../shared/tab-drag-geometry'
import {
  DEFAULT_IDLE_MS,
  defaultMaxLiveTabs,
  MEMORY_BUDGET_SHARE,
  pickTabsToSleep,
  SLEEP_SWEEP_INTERVAL_MS,
  type SleepPolicy,
} from './tab-hibernation'
>>>>>>> theirs

/** a tab lifted out of the strip with its live view: what "Open in New Window",
 *  tear-off and dock hand back and forth between the shell and a detached window */
export interface DetachedTab {
  view: WebContentsView
  kind: TabKind
  title: string
  filePath?: string
}

interface TabRecord {
  id: string
  kind: TabKind
  /** null for the Home tab — it's rendered by the shell window's own webContents */
  view: WebContentsView | null
  title: string
  filePath?: string
  /** chrome-free Present tab: no file, no editor menu or save/export targets */
  present?: boolean
<<<<<<< ours
  /**
   * Present tab only: the editing view whose live preview it shows. Its AI
   * turns and unsaved edits belong to that owner's document, so the poll
   * attributes them there (a present tab carries no file of its own).
   */
  ownerWcId?: number
=======
  /** when the tab last became or stopped being the active one */
  lastActiveAt: number
  /** never put to sleep (tab context menu) */
  pinned?: boolean
  /** renderer destroyed to free memory; `view` is null until the tab is shown again */
  dormant?: boolean
>>>>>>> theirs
}

const HOME_ID = 'home'
/** the highest top inset main accepts (CSS px): the S6 bar plus an open queue popover */
const TOP_INSET_MAX = 400

/**
 * Owns every open tab (Home + docs + sheets) inside the shell's single
 * BrowserWindow. Docs/sheets tabs are WebContentsView children of that
 * window; only the active one is visible at a time. Home has no view of its
 * own — hiding every other tab reveals the shell window's own content.
 */
export class TabManager {
  private readonly tabs: TabRecord[] = [
<<<<<<< ours
    { id: HOME_ID, kind: 'home', view: null, title: 'UniWork Office' },
=======
    { id: HOME_ID, kind: 'home', view: null, title: 'UniWork Office', lastActiveAt: Date.now() },
>>>>>>> theirs
  ]
  private activeId: string = HOME_ID
  /** Last activated Office editor tab (Home/My AI stays active while user chats). */
  private lastOfficeId: string | null = null
  private nextId = 1
  /** G8-11: the width the shell renderer draws the Discussion panel at (0 = closed) */
  private discussionPanelWidth = 0
  /** G5-03a: the S6 bar's height under the tab strip (0 = no bar); per shell window */
  private topInset = 0
  /** tab whose page entered HTML fullscreen (e.g. slides slideshow) — its view covers the tab strip */
  private htmlFullScreenId: string | null = null
  /** webContents ids whose view must cover the tab strip without HTML fullscreen
   *  (slides show: the window snaps via simpleFullScreen and asks for the bleed
   *  over IPC, since requestFullscreen would animate the native transition) */
  private readonly bleedWcIds = new Set<number>()
  /** tabs mid unsaved-changes prompt, so a second close click doesn't stack dialogs */
  private readonly closingIds = new Set<string>()
  private closedListener: ((tab: { kind: TabKind; filePath: string }) => void) | null = null
  /** views whose HTML-fullscreen listeners are installed: a view that leaves
   *  for a detached window and docks back must not get a second pair */
  private readonly fullScreenTracked = new WeakSet<WebContentsView>()
  private readonly closeChordTracked = new WeakSet<WebContents>()
  /** Sheets renderer mounted ahead of the next open: parsing its bundle and
   *  booting Univer is the bulk of a workbook's open time, and the shell hands
   *  the path over after mount anyway. */
  private spareSheetsView: WebContentsView | null = null
  private spareSheetsTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly shellWindow: BrowserWindow,
    private readonly onChanged: () => void,
    private readonly applyMenuFor: (kind: TabKind) => void,
    /** localized placeholder title for a tab that has no file yet */
    private readonly untitledTitleFor?: (kind: TabKind) => string,
    /**
     * The live interface scale (genoffice#1913). A getter rather than a value so a change
     * made from the View menu reaches the next layout without rebuilding this.
     */
    private readonly uiScale: () => number = () => 1,
<<<<<<< ours
    /** developer tools are offered (a development build): F12 opens them where the module does not bind it */
    private readonly devToolsEnabled: () => boolean = () => false,
    /**
     * UNI-2033: the title the tab strip shows for a tab (a read-only version copy says so). The
     * stored title stays the file name, so renames and re-titles keep working on the raw value.
     */
    private readonly decorateTitle: (filePath: string | undefined, title: string) => string = (
      _filePath,
      title,
    ) => title,
=======
>>>>>>> theirs
  ) {
    // Layout once synchronously for macOS/Windows (bounds are already correct),
    // then once more on the next tick. On Linux/X11, `resize` fires before the
    // window manager applies the new size, so getContentBounds() is still the
    // pre-maximize size inside the handler and a follow-up layout is required.
    // See https://github.com/genspark-ai/genoffice/issues/15
    shellWindow.on('resize', () => {
      this.layout()
      setImmediate(() => this.layout())
    })
<<<<<<< ours
    // the chrome (tab strip, Home, a dialog) can hold keyboard focus while a tab is active
    this.trackCloseChord(shellWindow.webContents)
=======
    // Windows fires `restore` when a minimized window comes back from the taskbar,
    // sometimes before the client bounds have settled — the same stale-geometry
    // race as Linux/X11 maximize (issue #15). Reconcile synchronously (the bounds
    // are usually already right) and once more on the next tick. Bounded: exactly
    // two layout passes per restore, no polling, no recurring timers.
    shellWindow.on('restore', () => {
      this.reconcileAfterWindowRestore()
      setImmediate(() => this.reconcileAfterWindowRestore())
    })
>>>>>>> theirs
  }

  private scheduleSpareSheetsView(delayMs: number): void {
    if (process.env.GENOFFICE_NO_SPARE_VIEW || this.spareSheetsTimer || this.spareSheetsView) return
    if (this.tabs.find((t) => t.id === this.activeId)?.kind !== 'sheets') return
    this.spareSheetsTimer = setTimeout(() => {
      this.spareSheetsTimer = null
      if (this.spareSheetsView || this.shellWindow.isDestroyed()) return
      const active = this.tabs.find((t) => t.id === this.activeId)
      if (active?.kind !== 'sheets') return
      const view = createSheetsView({ includeAiHandlers: false })
      // registering the session made the spare the menu-action target
      setActiveSheetsWebContents(active.view?.webContents ?? null)
      this.spareSheetsView = view
      this.trackCloseChord(view.webContents)
      this.shellWindow.contentView.addChildView(view)
      view.setVisible(false)
<<<<<<< ours
      view.setBounds(this.contentBounds())
      // Chromium focuses a new webContents inside createSheetsView (its loadURL),
      // before any `focus` listener exists, and OS keys sent to a hidden view
      // reach no webContents at all (no before-input-event, no menu
      // accelerator): Ctrl+W and typing died until a click in the grid.
      // Hand focus back now and again once the first load is done.
      this.refocusIfHidden(view.webContents)
      view.webContents.once('did-finish-load', () => this.refocusIfHidden(view.webContents))
=======
      // the window may be minimized or mid-restore when the spare spawns; a
      // degenerate rect would leave the spare zero-sized until its next layout
      const bounds = this.contentBounds()
      if (isSettledRect(bounds)) view.setBounds(bounds)
>>>>>>> theirs
      view.webContents.once('render-process-gone', () => {
        if (this.spareSheetsView !== view) return
        this.spareSheetsView = null
        view.webContents.close()
      })
    }, delayMs)
  }

  private takeSpareSheetsView(): WebContentsView | null {
    const view = this.spareSheetsView
    this.spareSheetsView = null
    return view && !view.webContents.isDestroyed() ? view : null
  }

  private discardSpareSheetsView(): void {
    if (this.spareSheetsTimer) clearTimeout(this.spareSheetsTimer)
    this.spareSheetsTimer = null
    const spare = this.spareSheetsView
    this.spareSheetsView = null
    if (!spare) return
    this.shellWindow.contentView.removeChildView(spare)
    spare.webContents.close()
  }

  private untitled(kind: TabKind, fallback: string): string {
    return this.untitledTitleFor?.(kind) ?? fallback
  }

  /** bounds for the view of tab `forId` (default: the active tab). activateTab
   *  asks for the tab it is about to show, so the full-bleed / panel rule is
   *  judged on the tab being shown, not on the one being left (W11A-3). */
  private contentBounds(forId: string | null = this.activeId): Rectangle {
    const { width, height } = this.shellWindow.getContentBounds()
    if (this.htmlFullScreenId !== null && this.htmlFullScreenId === forId) {
      return { x: 0, y: 0, width, height }
    }
    const active = this.tabs.find((t) => t.id === forId)
    if (active?.view && this.bleedWcIds.has(active.view.webContents.id)) {
      return { x: 0, y: 0, width, height }
    }
<<<<<<< ours
    // the Discussion panel is drawn by the shell renderer at the right edge,
    // under no view: the active editor view gives up the clamped panel width.
    // The strip is `zoom`ed by the interface scale, so its rendered height
    // grows with it — positioning the view at the unscaled constant would
    // paint the document underneath a taller tab strip.
    const panel = this.discussionPanelWidth
      ? clampDiscussionPanelWidth(this.discussionPanelWidth, width)
      : 0
    // the strip and the S6 bar under it both follow the interface scale (the
    // bar reports its unscaled CSS-px height), so the active view starts below both
    const scale = this.uiScale()
    const strip = tabStripHeight(scale)
    const inset = Math.round(this.topInset * scale)
    return {
      x: 0,
      y: strip + inset,
      width: Math.max(0, width - panel),
      height: Math.max(0, height - strip - inset),
    }
  }

  /**
   * G5-03a: the unscaled CSS-px height of the band the shell renderer draws
   * under the tab strip: the S6 "new version available" bar plus the open
   * queue popover (G5-06u; the renderer sends their sum). `contentBounds`
   * multiplies by `uiScale()` so a scale change re-layouts without a new
   * report. The band shows for the active tab only, so the renderer resends it
   * on every tab switch; 0 hides it and restores the view. Clamped to 0..400
   * CSS px (bar + popover) and rounded, so a stray report cannot blank the
   * editor. Full-bleed / fullscreen views ignore it (contentBounds).
   */
  setTopInset(px: number): void {
    if (!Number.isFinite(px)) return
    const next = Math.min(TOP_INSET_MAX, Math.max(0, Math.round(px)))
    if (next === this.topInset) return
    this.topInset = next
    this.layout()
  }

  /**
   * G8-11 (D1): open / close the shell's Discussion panel. The active view is
   * narrowed now; tab switches and window resizes re-apply it through
   * contentBounds(); closing restores the full width. A non-finite width
   * narrows nothing.
   */
  setDiscussionPanel(panel: { open: boolean; width: number }): void {
    this.discussionPanelWidth =
      panel.open && Number.isFinite(panel.width) ? Math.max(0, panel.width) : 0
    this.layout()
=======
    // The strip is `zoom`ed by the interface scale, so its rendered height
    // grows with it — positioning the view at the unscaled constant would paint
    // the document underneath a taller tab strip.
    const strip = tabStripHeight(this.uiScale())
    return { x: 0, y: strip, width, height: Math.max(0, height - strip) }
>>>>>>> theirs
  }

  /** Grow/restore a tab view over the tab strip on request (slides show fullscreen) */
  setContentBleed(wc: WebContents, on: boolean): void {
    if (on) this.bleedWcIds.add(wc.id)
    else this.bleedWcIds.delete(wc.id)
    this.layout()
  }

  /**
   * When a tab's page enters HTML fullscreen (the slides slideshow calls requestFullscreen),
   * grow its view over the tab strip so nothing of the shell chrome shows;
   * restore the normal bounds on leave.
   */
  private trackHtmlFullScreen(view: WebContentsView): void {
    if (this.fullScreenTracked.has(view)) return
    this.fullScreenTracked.add(view)
    // resolved at event time: the same view gets a fresh id every time it docks
    const currentId = () => this.tabs.find((t) => t.view === view)?.id
    view.webContents.on('enter-html-full-screen', () => {
      const id = currentId()
      if (id === undefined) return
      this.htmlFullScreenId = id
      this.layout()
    })
    view.webContents.on('leave-html-full-screen', () => {
      const id = currentId()
      if (id !== undefined && this.htmlFullScreenId === id) this.htmlFullScreenId = null
      this.layout()
    })
  }

  /**
   * The keys the shell takes before any page sees them (`matchShellKey`, from the
   * shortcut tables), whichever webContents of this window has keyboard focus: the
   * active tab's view, the shell chrome, a hidden view (the spare sheets view
   * mounted after an open can take focus), so they never depend on the menu
   * accelerator receiving the page's unhandled key. Close tab (Ctrl/Cmd+W) closes
   * the active tab; F6 / Shift+F6 move focus between the chrome and the tab; F12
   * opens the developer tools of a development build on a tab whose module does
   * not bind F12. A view that moved to a detached window keeps this listener but
   * is no longer ours, so its own window handles it. Home and chrome-free Present
   * tabs keep the default path for the close key.
   */
  private trackCloseChord(wc: WebContents): void {
    if (this.closeChordTracked.has(wc)) return
    this.closeChordTracked.add(wc)
    wc.on('before-input-event', (event, input) => {
      if (!this.ownsWebContents(wc)) return
      const active = this.tabs.find((t) => t.id === this.activeId)
      if (!active) return
      const key = matchShellKey(input, {
        platform: shortcutPlatform(),
        devTools: this.devToolsEnabled(),
        activeKind: active.kind,
      })
      if (!key) return
      switch (key.command) {
        case 'close-tab':
          if (!active.view || active.present) return
          event.preventDefault()
          this.closeActiveTab()
          return
        case 'cycle-region':
          if (this.cycleRegion(wc, active)) event.preventDefault()
          return
        case 'toggle-devtools':
          if (this.toggleDevTools(wc, active)) event.preventDefault()
          return
      }
    })
    // the chrome takes focus legitimately (tab strip, Home, dialogs); a hidden view
    // must not keep it. Deferred: a focus() call made inside Chromium's own focus
    // change does not stick (seen live: the spare kept focus until its load ended).
    if (wc !== this.shellWindow.webContents) {
      wc.on('focus', () => setImmediate(() => this.refocusIfHidden(wc)))
    }
  }

  /**
   * F6 / Shift+F6: keyboard focus moves between the window's two regions, the shell
   * chrome (tab strip) and the active tab. A tab's own regions (ribbon, document, side
   * pane) are not walked here. Home is one region (nothing to move to), and a hidden
   * view's key is left alone.
   */
  private cycleRegion(from: WebContents, active: TabRecord): boolean {
    if (!active.view || active.present) return false
    const chrome = this.shellWindow.webContents
    const content = active.view.webContents
    if (from === chrome) content.focus()
    else if (from === content) chrome.focus()
    else return false
    return true
  }

  /** Developer tools of the focused region, detached (docked ones sit under the tab views). */
  private toggleDevTools(from: WebContents, active: TabRecord): boolean {
    if (from !== this.shellWindow.webContents && from !== active.view?.webContents) return false
    if (from.isDevToolsOpened()) from.closeDevTools()
    else from.openDevTools({ mode: 'detach' })
    return true
  }

  /** A hidden view of this window holding keyboard focus swallows every OS key
   *  (they reach no webContents), so focus goes back to the active tab. */
  private refocusIfHidden(wc: WebContents): void {
    if (wc.isDestroyed() || !wc.isFocused() || !this.ownsWebContents(wc)) return
    if (this.tabs.find((t) => t.id === this.activeId)?.view?.webContents === wc) return
    this.focusActiveView()
  }

  /** the shell's own webContents, a tab view's or the spare's (not a detached window's) */
  private ownsWebContents(wc: WebContents): boolean {
    if (wc === this.shellWindow.webContents) return true
    if (this.spareSheetsView?.webContents === wc) return true
    return this.tabs.some((t) => t.view?.webContents === wc)
  }

  /** re-fit the active tab's view after a window resize */
  layout(): void {
    // Deferred resize layouts can land after the shell window was closed.
    if (this.shellWindow.isDestroyed()) return
    const bounds = this.contentBounds()
    // A minimized or mid-restore window can report a degenerate client rect;
    // applying it would shrink the active view to nothing — the white screen
    // after a Windows taskbar restore. Keep the last good layout instead.
    if (!isSettledRect(bounds)) return
    const active = this.tabs.find((t) => t.id === this.activeId)
    if (active?.view) active.view.setBounds(bounds)
  }

  /**
   * Re-fit the active view after the native window returns from the taskbar.
   * Deliberately narrower than activateTab: no visibility toggles, no focus,
   * no menu, no onChanged — the active tab, its WebContentsView and every
   * other document stay exactly as they were.
   */
  reconcileAfterWindowRestore(): void {
    if (this.shellWindow.isDestroyed() || this.shellWindow.isMinimized()) return
    this.layout()
  }

  /** files open in any tab, for the open-documents registry */
  openFilePaths(): string[] {
    return this.tabs.flatMap((t) => (t.filePath ? [t.filePath] : []))
  }

  list(): TabSummary[] {
    return this.tabs.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: this.decorateTitle(t.filePath, t.title),
      closable: t.id !== HOME_ID,
      active: t.id === this.activeId,
      ...(t.filePath ? { filePath: t.filePath } : {}),
      ...(t.dormant ? { dormant: true } : {}),
      ...(t.pinned ? { pinned: true } : {}),
    }))
  }

  private isOfficeTab(tab: TabRecord): boolean {
    return (
      !tab.present &&
      (tab.kind === 'docs' ||
        tab.kind === 'sheets' ||
        tab.kind === 'slides' ||
        tab.kind === 'pdf' ||
        tab.kind === 'markdown' ||
        tab.kind === 'html')
    )
  }

  /** Path of the focused Office tab, or the last Office tab if Home/My AI is active. */
  activeFilePath(): string | undefined {
    return this.activeOfficeTab()?.path
  }

  /**
   * Best Office tab for My AI “continue / summarize this file”.
   * Prefers the currently active editor; falls back to the last activated Office tab.
   */
  activeOfficeTab(): {
    id: string
    kind: TabKind
    title: string
    path?: string
    webContents?: WebContents
  } | null {
    const active = this.tabs.find((t) => t.id === this.activeId)
    if (active && this.isOfficeTab(active)) {
      return {
        id: active.id,
        kind: active.kind,
        title: active.title,
        ...(active.filePath ? { path: active.filePath } : {}),
        ...(active.view ? { webContents: active.view.webContents } : {}),
      }
    }
    if (this.lastOfficeId) {
      const last = this.tabs.find((t) => t.id === this.lastOfficeId)
      if (last && this.isOfficeTab(last)) {
        return {
          id: last.id,
          kind: last.kind,
          title: last.title,
          ...(last.filePath ? { path: last.filePath } : {}),
          ...(last.view ? { webContents: last.view.webContents } : {}),
        }
      }
    }
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      const t = this.tabs[i]!
      if (!this.isOfficeTab(t)) continue
      return {
        id: t.id,
        kind: t.kind,
        title: t.title,
        ...(t.filePath ? { path: t.filePath } : {}),
        ...(t.view ? { webContents: t.view.webContents } : {}),
      }
    }
    return null
  }

  /** Activate an Office tab and push an AI panel preset (create or continue). */
  pushAiPresetToOfficeTab(
    preset: { text: string; autoRun?: boolean; displayText?: string },
    tabId?: string,
  ): { ok: boolean; tabId?: string; kind?: TabKind; title?: string; path?: string } {
    const tab = tabId
      ? this.tabs.find((t) => t.id === tabId)
      : (() => {
          const info = this.activeOfficeTab()
          return info ? this.tabs.find((t) => t.id === info.id) : undefined
        })()
    if (!tab || !this.isOfficeTab(tab) || !tab.view || tab.view.webContents.isDestroyed()) {
      return { ok: false }
    }
    this.activateTab(tab.id)
    const payload = {
      text: preset.text,
      autoRun: preset.autoRun !== false,
      ...(preset.displayText ? { displayText: preset.displayText } : {}),
    }
    if (tab.kind === 'docs') queueDocsAiPreset(tab.view.webContents.id, payload)
    else if (tab.kind === 'slides') queueSlidesAiPreset(tab.view.webContents.id, payload)
    else if (tab.kind === 'sheets') queueSheetsAiPreset(tab.view.webContents.id, payload)
    else if (tab.kind === 'pdf') queuePdfAiPreset(tab.view.webContents.id, payload)
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.send('my-ai:ai-preset', payload)
    }
    return {
      ok: true,
      tabId: tab.id,
      kind: tab.kind,
      title: tab.title,
      ...(tab.filePath ? { path: tab.filePath } : {}),
    }
  }

  /**
   * Documents an MCP agent may act on: every editor tab except Home (no file)
   * and chrome-free Present tabs (a live preview of another tab's document, so
   * acting on it would double-count that document).
   *
   * Dirtiness is resolved here per family because it is not uniform — five
   * families answer synchronously in the main process, docs has to ask its
   * renderer. Hence the async signature.
   */
  async openDocuments(): Promise<OpenDocumentTab[]> {
    const tabs = this.tabs.filter(
      (tab) => tab.kind !== 'home' && !tab.present && (tab.view || tab.dormant),
    )
    return Promise.all(
      tabs.map(async (tab) => ({
        id: tab.id,
        kind: tab.kind as DocumentTabKind,
        title: tab.title,
        ...(tab.filePath ? { filePath: tab.filePath } : {}),
        active: tab.id === this.activeId,
        dirty: await this.tabIsDirty(tab),
      })),
    )
  }

  /** unsaved-changes state of one tab, whichever family owns it */
  private async tabIsDirty(tab: TabRecord): Promise<boolean> {
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return false
    switch (tab.kind) {
      case 'sheets':
        return sheetsPendingEditCount(wc.id) > 0
      case 'pdf':
        return pdfIsDirty(wc.id)
      case 'markdown':
        return markdownIsDirty(wc.id)
      case 'html':
        return htmlIsDirty(wc.id)
      case 'slides':
        return slidesIsDirty(wc.id)
      case 'docs':
        return docsQueryDirty(wc)
      default:
        return false
    }
  }

  /**
   * Unsaved edits in the editor of every tab showing a file `wanted` accepts
   * (the UniWork chip's dirty state). null: the editor did not answer (docs
   * busy saving), so the caller keeps what it last knew. aiRunning: the
   * editor reported an AI turn in progress (ai-run-registry); read after the
   * dirty answer, so a tab closed meanwhile reads false. aiEpoch: how many AI
   * turns the view has started (never decreases). Present tabs carry no file:
   * their owner tab answers for the document, with the present view's own AI
   * turn and epoch folded in.
   */
  async editorDirtyStates(wanted: (path: string) => boolean): Promise<EditorState[]> {
    const tabs = this.tabs.filter((t) => t.view && t.filePath && !t.present && wanted(t.filePath))
    return Promise.all(
      tabs.map(async (tab) => {
        const dirty =
          tab.kind === 'docs' && tab.view && !tab.view.webContents.isDestroyed()
            ? await docsQueryEditorDirty(tab.view.webContents)
            : await this.tabIsDirty(tab)
        const wc = tab.view?.webContents
        const open = this.tabs.includes(tab) && !!wc && !wc.isDestroyed()
        // the owner tab's own view plus every present view of it: a turn in
        // either belongs to this document
        const views = [...(open && wc ? [wc.id] : []), ...this.presentViewIdsOf(tab)]
        return {
          path: tab.filePath!,
          dirty,
          aiRunning: views.some((id) => isAiRunning(id)),
          aiEpoch: views.reduce((sum, id) => sum + aiEpochOf(id), 0),
        }
      }),
    )
  }

  /**
   * The live present views showing `owner`'s preview. A present view whose
   * webContents was destroyed (or that has left the strip) is skipped: it is no
   * longer a view of the document.
   */
  private presentViewIdsOf(owner: TabRecord): number[] {
    const ownerWc = owner.view?.webContents
    if (!ownerWc) return []
    return this.tabs
      .filter(
        (t) =>
          t.present && t.ownerWcId === ownerWc.id && t.view && !t.view.webContents.isDestroyed(),
      )
      .map((t) => t.view!.webContents.id)
  }

  openHomeTab(): void {
    this.activateTab(HOME_ID)
  }

  /** The in-app user manual (issue #1520): a closable tab showing the shell
      renderer's help mode — the same bundle, branched on ?mode=help, so no
      second renderer build is needed. */
  openHelpTab(): string {
    // F1 again, or the Help menu while the manual is already open, focuses it
    // instead of stacking a second copy: the tab is closable (only Home is
    // not), so "press F1 again" is an ordinary thing to do
    const existing = this.tabs.find((t) => t.kind === 'help')
    if (existing) {
      this.activateTab(existing.id)
      return existing.id
    }
    const view = createHelpView()
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.tabs.push({
      id,
      kind: 'help',
      view,
      title: this.untitled('help', 'UniWork Office Help'),
      lastActiveAt: Date.now(),
    })
    this.activateTab(id)
    return id
  }

  openDocsTab(
    openPath?: string,
    options?: { newBlank?: boolean; aiContent?: AiDocContent; aiPreset?: AiPresetPayload },
  ): string {
    const view = createDocsView(openPath)
    const id = `t${this.nextId++}`
    if (options?.newBlank) markDocsNewBlank(view.webContents.id)
    if (options?.aiContent) queueDocsAiContent(view.webContents.id, options.aiContent)
    if (options?.aiPreset) queueDocsAiPreset(view.webContents.id, options.aiPreset)
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(view)
    this.trackCloseChord(view.webContents)
    this.tabs.push({
      id,
      lastActiveAt: Date.now(),
      kind: 'docs',
      view,
      title: openPath ? basename(openPath) : this.untitled('docs', 'UniWork Docs'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  openSheetsTab(
    openPath?: string,
    options?: { newBlank?: boolean; aiPreset?: SheetsAiPresetPayload },
  ): string {
    if (options?.newBlank) setSheetsNewBlank()
    const spare = this.takeSpareSheetsView()
    const view =
      spare ?? createSheetsView({ includeAiHandlers: false, openingWorkbook: Boolean(openPath) })
    // bind the path to this tab's webContents: a multi-select Open creates
    // several sheets tabs in one loop, so a single global path would be
    // overwritten before the earlier tabs consume it
    if (openPath) {
      queueWorkbookForView(view.webContents, openPath)
      if (spare) nudgeQueuedWorkbook(view.webContents)
    }
    if (options?.aiPreset) queueSheetsAiPreset(view.webContents.id, options.aiPreset)
    const id = `t${this.nextId++}`
    if (!spare) {
      this.shellWindow.contentView.addChildView(view)
      view.setVisible(false)
    }
    this.trackHtmlFullScreen(view)
    this.trackCloseChord(view.webContents)
    this.tabs.push({
      id,
      lastActiveAt: Date.now(),
      kind: 'sheets',
      view,
      title: openPath ? basename(openPath) : this.untitled('sheets', 'AI Sheets'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  openSlidesTab(openPath?: string, options?: { aiPreset?: SlidesAiPresetPayload }): string {
    const view = createSlidesView(openPath)
    const id = `t${this.nextId++}`
    if (options?.aiPreset) queueSlidesAiPreset(view.webContents.id, options.aiPreset)
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(view)
    this.trackCloseChord(view.webContents)
    this.tabs.push({
      id,
      lastActiveAt: Date.now(),
      kind: 'slides',
      view,
      title: openPath ? basename(openPath) : this.untitled('slides', 'AI Slides'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  openPdfTab(openPath: string, options?: { aiPreset?: PdfAiPresetPayload }): string {
    const view = createPdfView(openPath)
    const id = `t${this.nextId++}`
    if (options?.aiPreset) queuePdfAiPreset(view.webContents.id, options.aiPreset)
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(view)
<<<<<<< ours
    this.trackCloseChord(view.webContents)
    this.tabs.push({ id, kind: 'pdf', view, title: basename(openPath), filePath: openPath })
=======
    this.tabs.push({
      id,
      kind: 'pdf',
      view,
      title: basename(openPath),
      filePath: openPath,
      lastActiveAt: Date.now(),
    })
>>>>>>> theirs
    this.activateTab(id)
    return id
  }

  /** Remount the tab's renderer so it re-reads its file from disk (View > Reload). */
  reloadTab(id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    const wc = tab?.view?.webContents
    if (!wc || wc.isDestroyed()) return
    reloadViewFromDisk(wc, tab.kind, tab.filePath)
  }

  openMarkdownTab(openPath?: string): string {
    const view = createMarkdownView(openPath)
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(view)
    this.trackCloseChord(view.webContents)
    this.tabs.push({
      id,
      lastActiveAt: Date.now(),
      kind: 'markdown',
      view,
      title: openPath ? basename(openPath) : this.untitled('markdown', 'AI Markdown'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  openHtmlTab(openPath?: string): string {
    const view = createHtmlView(openPath)
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(view)
    this.trackCloseChord(view.webContents)
    this.tabs.push({
      id,
      lastActiveAt: Date.now(),
      kind: 'html',
      view,
      title: openPath ? basename(openPath) : this.untitled('html', 'AI HTML'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  /** Present → New tab: a chrome-free html tab showing the owner tab's live preview */
  openHtmlPresentTab(owner: WebContents, title: string): string {
    const view = createHtmlPresentView(owner, title)
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(view)
    this.trackCloseChord(view.webContents)
    this.tabs.push({
      id,
      lastActiveAt: Date.now(),
      kind: 'html',
      view,
      title: title || this.untitled('html', 'AI HTML'),
      present: true,
      ownerWcId: owner.id,
    })
    this.activateTab(id)
    return id
  }

  activateTab(id: string): void {
    const target = this.tabs.find((t) => t.id === id)
    if (!target) return
    if (target.dormant) this.reviveTab(target)
    const now = Date.now()
    const previous = this.tabs.find((t) => t.id === this.activeId)
    if (previous) previous.lastActiveAt = now
    target.lastActiveAt = now
    for (const t of this.tabs) t.view?.setVisible(t.id === id)
<<<<<<< ours
    if (target.view) target.view.setBounds(this.contentBounds(id))
=======
    const bounds = this.contentBounds()
    // a bring-forward while the window is minimized or mid-restore must not
    // zero-size the view being activated (same guard as layout())
    if (target.view && isSettledRect(bounds)) target.view.setBounds(bounds)
>>>>>>> theirs
    this.activeId = id
    if (this.isOfficeTab(target)) this.lastOfficeId = id
    if (target.kind === 'sheets') this.scheduleSpareSheetsView(3000)
    else this.discardSpareSheetsView()
    this.refreshActiveTargets()
    this.focusActiveView()
    this.onChanged()
  }

  /** Hand keyboard focus to the active tab's view. The click that opened or
   *  switched a tab lands on the chrome webContents (tab strip, Home list),
   *  and a WebContentsView made visible does not take focus on its own — so
   *  without this, typing after every open/switch keeps going to a hidden
   *  view. Home has no view of its own; the shell window's webContents is
   *  the focus target there. Skipped while the window is unfocused
   *  (background opens must not steal OS focus); the window's `focus`
   *  handler re-runs it. */
  focusActiveView(): void {
    if (this.shellWindow.isDestroyed() || !this.shellWindow.isFocused()) return
    const target = this.tabs.find((t) => t.id === this.activeId)
    if (!target) return
    if (target.view) target.view.webContents.focus()
    else this.shellWindow.webContents.focus()
  }

  /** Re-point the process-global active-editor targets and the app menu at this
   *  window's active tab. Called on every activation and on shell-window focus:
   *  a detached editor window ("Open in New Window") claims the same globals
   *  while it is focused. */
  refreshActiveTargets(): void {
    const target = this.tabs.find((t) => t.id === this.activeId)
    if (!target) return
    setActiveDocsResolver(target.kind === 'docs' ? () => target.view!.webContents : () => null)
    if (target.kind === 'sheets' && target.view) setActiveSheetsWebContents(target.view.webContents)
    if (target.kind === 'slides' && target.view) setActiveSlidesWebContents(target.view.webContents)
    this.applyMenuFor(target.present ? 'home' : target.kind)
  }

  /** move a tab to a new index in the strip; Home is pinned at index 0 */
  reorderTab(id: string, toIndex: number): void {
    if (id === HOME_ID) return
    const fromIndex = this.tabs.findIndex((t) => t.id === id)
    if (fromIndex < 0) return
    const clamped = Math.min(Math.max(Math.trunc(toIndex), 1), this.tabs.length - 1)
    if (clamped === fromIndex) return
    const [moved] = this.tabs.splice(fromIndex, 1)
    this.tabs.splice(clamped, 0, moved)
    this.onChanged()
  }

  /** kind, title and file of the document tab rendered by `webContentsId` (Home has no view) */
  describeWebContents(
    webContentsId: number,
  ): { kind: TabKind; title: string; filePath?: string } | null {
    const tab = this.tabs.find((t) => t.view?.webContents.id === webContentsId)
    if (!tab) return null
    return { kind: tab.kind, title: tab.title, ...(tab.filePath ? { filePath: tab.filePath } : {}) }
  }

  /**
   * true for the webContents of any tab view (Present views included) and for the
   * spare sheets view, which is not in `tabs` until a sheets tab takes it; the IPC
   * sender guard reads this to tell an editor view from a stranger
   */
  hasWebContents(webContentsId: number): boolean {
    if (this.spareSheetsView?.webContents.id === webContentsId) return true
    return this.tabs.some((t) => t.view?.webContents.id === webContentsId)
  }

  tabIdForWebContents(webContentsId: number): string | undefined {
    return this.tabs.find((t) => t.view?.webContents.id === webContentsId)?.id
  }

  /** a module opened a file inside an existing tab (⌘O / queued path) — sync title + dedupe path */
  setTabFileFor(webContentsId: number, filePath: string): void {
    const tab = this.tabs.find((t) => t.view?.webContents.id === webContentsId)
    if (!tab) return
    tab.filePath = filePath
    tab.title = basename(filePath)
    this.onChanged()
  }

  /** an untitled document named itself before its first save (html: from the first AI request) */
  setTabTitleFor(webContentsId: number, title: string): void {
    const tab = this.tabs.find((t) => t.view?.webContents.id === webContentsId)
    if (!tab || tab.filePath || tab.title === title) return
    tab.title = title
    this.onChanged()
  }

  /** a file was renamed on disk (rename from the Home list) — sync any open tab's title/path;
   *  returns the affected views so callers can notify the embedded editors */
  renameTabFile(
    oldPath: string,
    newPath: string,
  ): Array<{ kind: TabKind; webContents: WebContents }> {
    const affected: Array<{ kind: TabKind; webContents: WebContents }> = []
    let renamed = 0
    for (const tab of this.tabs) {
      if (tab.filePath !== oldPath) continue
      tab.filePath = newPath
      tab.title = basename(newPath)
      renamed++
      if (tab.view) affected.push({ kind: tab.kind, webContents: tab.view.webContents })
    }
    if (renamed > 0) this.onChanged()
    return affected
  }

  /**
   * A document's title changed on the server while its working copy keeps its
   * file name (an editor holds it, so the file is not moved): re-title the open
   * tab by path and return its view, so the caller can tell the embedded editor.
   */
  retitleTabFile(path: string, title: string): Array<{ kind: TabKind; webContents: WebContents }> {
    const affected: Array<{ kind: TabKind; webContents: WebContents }> = []
    const wanted = canonicalPath(path)
    for (const tab of this.tabs) {
      if (!tab.filePath || canonicalPath(tab.filePath) !== wanted) continue
      if (tab.title === title) continue
      tab.title = title
      if (tab.view) affected.push({ kind: tab.kind, webContents: tab.view.webContents })
    }
    if (affected.length > 0) this.onChanged()
    return affected
  }

  /** sheets tabs whose renderer reports unsaved journal edits (shell-close guard) */
  dirtySheetsTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter(
        (t) => t.kind === 'sheets' && t.view && sheetsPendingEditCount(t.view.webContents.id) > 0,
      )
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** pdf tabs whose renderer reports unsaved markups/form edits (shell-close guard) */
  dirtyPdfTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'pdf' && t.view && pdfIsDirty(t.view.webContents.id))
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** markdown tabs whose renderer reports unsaved edits (shell-close guard) */
  dirtyMarkdownTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'markdown' && t.view && markdownIsDirty(t.view.webContents.id))
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** html tabs whose renderer reports unsaved edits (shell-close guard) */
  dirtyHtmlTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'html' && t.view && htmlIsDirty(t.view.webContents.id))
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** slides tabs whose main-process session has unsaved edits (shell-close guard) */
  dirtySlidesTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'slides' && t.view && slidesIsDirty(t.view.webContents.id))
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** all live docs tabs — dirtiness lives renderer-side, caller queries async (shell-close guard) */
  docsTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'docs' && t.view)
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** all live slides tabs (MCP bridge resolves its new tab's webContents through this) */
  slidesTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'slides' && t.view)
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** all live sheets tabs (MCP bridge resolves its new tab's webContents through this) */
  sheetsTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'sheets' && t.view)
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** closes whichever tab is currently active; no-op for Home (Cmd+W target) */
  closeActiveTab(): void {
    void this.closeTab(this.activeId)
  }

  async closeTab(id: string): Promise<void> {
    if (id === HOME_ID) return
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab || this.closingIds.has(id)) return
    if (!(await this.confirmTabClose(tab))) return
    this.removeTab(id)
  }

  /**
   * The prompts of a close, with nothing removed: the module's unsaved-changes
   * prompt, then the UniWork prompt. False when the user cancelled one (or one
   * is already open on the tab) and the tab must stay.
   */
  private async confirmTabClose(tab: TabRecord): Promise<boolean> {
    const id = tab.id
    let closeGuard =
      tab.view &&
      (tab.kind === 'sheets' && sheetsPendingEditCount(tab.view.webContents.id) > 0
        ? requestSheetsClose
        : tab.kind === 'pdf' && pdfIsDirty(tab.view.webContents.id)
          ? requestPdfClose
          : tab.kind === 'markdown' && markdownIsDirty(tab.view.webContents.id)
            ? requestMarkdownClose
            : tab.kind === 'html' && htmlIsDirty(tab.view.webContents.id)
              ? requestHtmlClose
              : tab.kind === 'slides' && slidesIsDirty(tab.view.webContents.id)
                ? requestSlidesClose
                : null)
    // docs dirty state lives in the renderer and needs an async query; skip the guard when clean (avoids a flash activation)
    if (!closeGuard && tab.kind === 'docs' && tab.view) {
      this.closingIds.add(id)
      try {
        if (await docsQueryDirty(tab.view.webContents)) closeGuard = requestDocsClose
      } finally {
        this.closingIds.delete(id)
      }
    }
    if (closeGuard && tab.view) {
      // Bring the tab into view so the save prompt has visible context.
      if (this.activeId !== id) this.activateTab(id)
      this.closingIds.add(id)
      try {
        if (!(await closeGuard(tab.view.webContents, this.shellWindow))) return false
      } finally {
        this.closingIds.delete(id)
      }
    }
    // a UniWork document whose local changes are not in UniWork yet
    if (tab.view && !tab.present && isUniworkCloseGuarded(tab.filePath)) {
      this.closingIds.add(id)
      try {
        if (!(await confirmUniworkClose(tab.filePath))) return false
      } finally {
        this.closingIds.delete(id)
      }
    }
    return true
  }

  /**
   * Closes every tab showing `path` through the normal close (prompts
   * included). True when no tab shows it any more; false when a prompt was
   * cancelled and the tab stays.
   */
  async closeTabsShowing(path: string): Promise<boolean> {
    const wanted = canonicalPath(path)
    const showing = () =>
      this.tabs.filter((t) => t.filePath && canonicalPath(t.filePath) === wanted).map((t) => t.id)
    for (const id of showing()) await this.closeTab(id)
    return showing().length === 0
  }

  /**
   * Runs the close prompts of every tab showing `path` and removes nothing
   * (the first half of an all-or-nothing close, see closeTabsShowingNow).
   * False when a prompt was cancelled.
   */
  async confirmCloseTabsShowing(path: string): Promise<boolean> {
    const wanted = canonicalPath(path)
    const showing = this.tabs.filter((t) => t.filePath && canonicalPath(t.filePath) === wanted)
    for (const tab of showing) {
      if (this.closingIds.has(tab.id)) return false
      if (!(await this.confirmTabClose(tab))) return false
    }
    return true
  }

  /** Removes every tab showing `path` with no prompt: its prompts were answered already. */
  closeTabsShowingNow(path: string): void {
    const wanted = canonicalPath(path)
    for (const tab of this.tabs.filter((t) => t.filePath && canonicalPath(t.filePath) === wanted))
      this.closeTabWithoutPrompt(tab.id)
  }

  /**
   * tabs showing an editable UniWork copy of ours whose close would show the
   * UniWork prompt (shell-close guard); clean copies are not listed, so a
   * window with only clean documents keeps the "nothing to protect" path
   */
  uniworkGuardedTabs(): Array<{ id: string; path: string }> {
    return this.tabs
      .filter((t) => t.view && !t.present && uniworkNeedsClosePrompt(t.filePath))
      .map((t) => ({ id: t.id, path: t.filePath as string }))
  }

  /**
   * Close a tab with no save prompt. The caller must have already settled the
   * document's unsaved changes (the MCP close tool saves or discards first):
   * this is the plain removal step of `closeTab`, so a dialog never appears in
   * a flow the user did not start.
   * Returns false when there is no such tab (already closed) or one is mid-prompt.
   */
  closeTabWithoutPrompt(id: string): boolean {
    if (id === HOME_ID) return false
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab || this.closingIds.has(id)) return false
    this.removeTab(id)
    return true
  }

  /** detach + drop one tab and re-activate a neighbour (no guards, no prompts) */
  private removeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    if (this.htmlFullScreenId === id) this.htmlFullScreenId = null
    const [removed] = this.tabs.splice(idx, 1)
<<<<<<< ours
    if (removed.filePath) notePathsDropped([removed.filePath])
=======
    if (removed.filePath && !removed.present)
      this.closedListener?.({ kind: removed.kind, filePath: removed.filePath })
>>>>>>> theirs
    if (this.activeId === id) {
      const fallback = this.tabs[idx - 1] ?? this.tabs[0]
      this.activateTab(fallback.id)
    } else {
      this.onChanged()
    }
    if (removed.view) {
      removed.view.setVisible(false)
      this.shellWindow.contentView.removeChildView(removed.view)
<<<<<<< ours
      // G5-03a: a tab closed mid AI turn must not keep the document "busy";
      // a docs view is blanked (not destroyed), so its flag is cleared here
      clearAiRun(removed.view.webContents.id)
      if (removed.kind === 'docs') {
        // webContents.close()/.destroy() on a closed docs tab wedges Electron's whole
        // UI thread in a native modal run loop (reproduced consistently; survives
        // close() vs destroy(), teardown ordering, deferring, and disabling
        // accessibility support — looks like an upstream WebContentsView/Chromium
        // issue, not something fixable from here). Detaching without destroying
        // avoids the freeze; the orphaned webContents is reclaimed when the app quits.
        teardownDocsRenderer(removed.view.webContents)
        blankRetiredPage(removed.view.webContents)
      } else {
        removed.view.webContents.close()
      }
=======
      destroyView(removed.kind, removed.view)
>>>>>>> theirs
    }
  }

  /** a tab with a renderer; dormant and Home tabs have none */
  private isLive(tab: TabRecord): boolean {
    return !!tab.view
  }

  setPinned(id: string, pinned: boolean): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab || tab.kind === 'home') return
    tab.pinned = pinned
    this.onChanged()
  }

  /**
   * Destroy the renderer of a background tab and keep only what is needed to
   * reopen it: kind, path, title, position. Refuses the active tab, pinned
   * tabs, untitled documents, Present tabs, the manual, a tab mid-prompt or in
   * HTML fullscreen, and anything with unsaved changes. Resolves true when the
   * tab went to sleep.
   */
  async sleepTab(id: string): Promise<boolean> {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab?.view || !this.canSleep(tab)) return false
    if (await this.tabIsDirty(tab)) return false
    // re-check: the dirty query yielded, and the user may have switched here meanwhile
    if (!tab.view || !this.canSleep(tab)) return false
    const view = tab.view
    tab.view = null
    tab.dormant = true
    view.setVisible(false)
    this.shellWindow.contentView.removeChildView(view)
    destroyView(tab.kind, view)
    this.onChanged()
    return true
  }

  private canSleep(tab: TabRecord): boolean {
    return (
      tab.id !== this.activeId &&
      !tab.pinned &&
      !tab.present &&
      !!tab.filePath &&
      tab.kind !== 'home' &&
      tab.kind !== 'help' &&
      !this.closingIds.has(tab.id) &&
      this.htmlFullScreenId !== tab.id
    )
  }

  /** rebuild a sleeping tab's view from its file, in place; the caller shows it */
  private reviveTab(tab: TabRecord): void {
    const view = createViewFor(tab.kind, tab.filePath)
    if (!view) return
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(view)
    tab.view = view
    tab.dormant = false
    tab.lastActiveAt = Date.now()
  }

  /** a sleeping tab asked for by its webContents (agents, CLI, menus) wakes in the background */
  private ensureLive(tab: TabRecord | undefined): TabRecord | undefined {
    if (tab?.dormant) {
      this.reviveTab(tab)
      this.onChanged()
    }
    return tab
  }

  /**
   * One pass of the sleep policy: background tabs idle past `policy.idleMs`
   * sleep while more than `policy.maxLiveTabs` renderers are alive; over the
   * memory budget the oldest sleeps regardless. Returns the ids put to sleep.
   */
  async sleepIdleTabs(
    policy: SleepPolicy,
    now = Date.now(),
    overBudget = false,
  ): Promise<string[]> {
    const live = this.tabs.filter((t) => this.isLive(t))
    const candidates: { id: string; lastActiveAt: number }[] = []
    // dirtiness is resolved here, not in canSleep: it is async for docs, and a
    // dirty tab left among the candidates would be picked (and refused) on
    // every sweep, starving the clean tabs behind it
    for (const t of live) {
      if (this.canSleep(t) && !(await this.tabIsDirty(t)))
        candidates.push({ id: t.id, lastActiveAt: t.lastActiveAt })
    }
    const slept: string[] = []
    for (const id of pickTabsToSleep(candidates, live.length, policy, now, overBudget)) {
      if (await this.sleepTab(id)) slept.push(id)
    }
    return slept
  }

  /**
   * Run the sleep policy every minute while `enabled()` holds. The live-tab
   * cap follows the machine's memory; the budget check sums every process of
   * the app against a share of physical memory.
   */
  startSleepSweeper(enabled: () => boolean): () => void {
    const policy: SleepPolicy = {
      maxLiveTabs:
        envNumber('GENOFFICE_TAB_SLEEP_MAX_LIVE') ??
        defaultMaxLiveTabs(process.getSystemMemoryInfo().total * 1024),
      idleMs: envNumber('GENOFFICE_TAB_SLEEP_IDLE_MS') ?? DEFAULT_IDLE_MS,
    }
    let running = false
    const timer = setInterval(
      () => {
        if (!enabled() || running || this.shellWindow.isDestroyed()) return
        running = true
        void this.sleepIdleTabs(policy, Date.now(), appOverMemoryBudget()).finally(() => {
          running = false
        })
      },
      envNumber('GENOFFICE_TAB_SLEEP_SWEEP_MS') ?? SLEEP_SWEEP_INTERVAL_MS,
    )
    timer.unref?.()
    return () => clearInterval(timer)
  }

  /** told when a tab with a file is closed (not detached), so it can be reopened */
  setClosedListener(listener: ((tab: { kind: TabKind; filePath: string }) => void) | null): void {
    this.closedListener = listener
  }

  /** Remove a tab from the strip WITHOUT destroying its WebContentsView and
   *  hand it to the caller ("Open in New Window" — the live document, unsaved
   *  edits included, moves into a detached editor window). Null while a close
   *  prompt is pending on the tab. */
  detachTab(id: string): DetachedTab | null {
    if (id === HOME_ID) return null
    const idx = this.tabs.findIndex((t) => t.id === id)
    const tab = idx >= 0 ? this.tabs[idx] : undefined
    if (!tab?.view || tab.present || this.closingIds.has(id)) return null
    this.tabs.splice(idx, 1)
    if (this.htmlFullScreenId === id) this.htmlFullScreenId = null
    const view = tab.view
    view.setVisible(false)
    this.shellWindow.contentView.removeChildView(view)
    if (this.activeId === id) {
      const fallback = this.tabs[idx - 1] ?? this.tabs[0]
      this.activateTab(fallback.id)
    } else {
      this.onChanged()
    }
    return { view, kind: tab.kind, title: tab.title, filePath: tab.filePath }
  }

  /** Whether a tab can leave the strip for its own window (tear-off / Open in
   *  New Window): every document tab except a chrome-free Present tab. */
  canDetachTab(id: string): boolean {
    const tab = this.tabs.find((t) => t.id === id)
    return !!tab?.view && !tab.present && !this.closingIds.has(id)
  }

  /**
   * The inverse of detachTab: a live view coming back from a detached window
   * (dock by dragging the window onto the strip, or a tear-off that returned
   * mid-gesture) becomes a tab again at `index` — Home stays pinned at 0, an
   * out-of-range or omitted index appends — and is activated. The document,
   * unsaved edits included, is untouched: only the view's parent changes.
   */
  attachTab(record: DetachedTab, index?: number): string {
    const id = `t${this.nextId++}`
    const { view } = record
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(view)
    this.trackCloseChord(view.webContents)
    const slot =
      index === undefined || !Number.isFinite(index)
        ? this.tabs.length
        : Math.min(Math.max(Math.trunc(index), 1), this.tabs.length)
    this.tabs.splice(slot, 0, {
      id,
      kind: record.kind,
      view,
      title: record.title,
      filePath: record.filePath,
      lastActiveAt: Date.now(),
    })
    this.activateTab(id)
    return id
  }

  /** the editor tab showing this file, whichever module owns it (path compared after resolving links) */
  findTabByPath(
    path?: string,
  ): { id: string; kind: TabKind; webContents: WebContents } | undefined {
    const wanted = canonicalPath(path)
    const tab = this.ensureLive(
      this.tabs.find(
        (t) =>
          (t.view || t.dormant) && t.filePath && !t.present && canonicalPath(t.filePath) === wanted,
      ),
    )
    return tab?.view ? { id: tab.id, kind: tab.kind, webContents: tab.view.webContents } : undefined
  }

  webContentsForTab(id: string): WebContents | undefined {
    return this.ensureLive(this.tabs.find((t) => t.id === id))?.view?.webContents
  }

  private findTabOfKindByPath(kind: TabKind, path?: string): string | undefined {
    const wanted = canonicalPath(path)
    return this.tabs.find(
      (t) =>
        t.kind === kind &&
        (t.view || t.dormant) &&
        t.filePath &&
        !t.present &&
        canonicalPath(t.filePath) === wanted,
    )?.id
  }

  findDocsTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('docs', path)
  }

  findSheetsTab(): string | undefined {
    return this.tabs.find((t) => t.kind === 'sheets')?.id
  }

  findSheetsTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('sheets', path)
  }

  findSlidesTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('slides', path)
  }

  findPdfTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('pdf', path)
  }

  findMarkdownTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('markdown', path)
  }

  findHtmlTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('html', path)
  }

  /** the active tab's html view, if the active tab is html (html menu target) */
  activeHtmlTab(): { id: string; webContents: WebContents; filePath?: string } | undefined {
    const tab = this.tabs.find((t) => t.id === this.activeId)
    return tab?.kind === 'html' && tab.view && !tab.present
      ? { id: tab.id, webContents: tab.view.webContents, filePath: tab.filePath }
      : undefined
  }

  /** the active tab's markdown view, if the active tab is markdown (markdown menu target) */
  activeMarkdownTab(): { id: string; webContents: WebContents; filePath?: string } | undefined {
    const tab = this.tabs.find((t) => t.id === this.activeId)
    return tab?.kind === 'markdown' && tab.view
      ? { id: tab.id, webContents: tab.view.webContents, filePath: tab.filePath }
      : undefined
  }

  /** the active tab's pdf view, if the active tab is a pdf (pdf menu target) */
  activePdfTab(): { id: string; webContents: WebContents; filePath?: string } | undefined {
    const tab = this.tabs.find((t) => t.id === this.activeId)
    return tab?.kind === 'pdf' && tab.view
      ? { id: tab.id, webContents: tab.view.webContents, filePath: tab.filePath }
      : undefined
  }
}

/** the editor view for a tab rebuilt from its file (sleep/wake); null for kinds that cannot be */
function createViewFor(kind: TabKind, filePath: string | undefined): WebContentsView | null {
  if (!filePath) return null
  switch (kind) {
    case 'docs':
      return createDocsView(filePath)
    case 'sheets': {
      const view = createSheetsView({ includeAiHandlers: false, openingWorkbook: true })
      queueWorkbookForView(view.webContents, filePath)
      return view
    }
    case 'slides':
      return createSlidesView(filePath)
    case 'pdf':
      return createPdfView(filePath)
    case 'markdown':
      return createMarkdownView(filePath)
    case 'html':
      return createHtmlView(filePath)
    default:
      return null
  }
}

/** release a view's renderer; docs needs its main-process bookkeeping dropped first */
function destroyView(kind: TabKind, view: WebContentsView): void {
  if (view.webContents.isDestroyed()) return
  if (kind === 'docs') teardownDocsRenderer(view.webContents)
  view.webContents.close()
}

/** test hooks: the sweep is minutes-scale by design, too slow for an e2e run */
function envNumber(name: string): number | undefined {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function appOverMemoryBudget(): boolean {
  try {
    const usedKB = app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0)
    return usedKB > process.getSystemMemoryInfo().total * MEMORY_BUDGET_SHARE
  } catch {
    return false
  }
}

export function canonicalPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** The manual shares the shell's renderer bundle and preload: the view is just
    the shell renderer at ?mode=help. Dev serves it from the dev server, the
    packaged app from the `help` scheme root registered in shell main. */
function createHelpView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  view.webContents.setWindowOpenHandler(({ url }) => {
    const target = safeExternalUrl(url)
    if (target) void shell.openExternal(target)
    return { action: 'deny' }
  })
  void view.webContents.loadURL(
    rendererUrl(process.env.ELECTRON_RENDERER_URL, 'help', { mode: 'help' }),
  )
  return view
}
