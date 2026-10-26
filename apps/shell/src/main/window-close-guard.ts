import { app, type BrowserWindow } from 'electron'

import { docsQueryDirty, requestDocsClose } from '../../../docs/src/main/docs-main'
import { requestSheetsClose, resetSheetsShuttingDown } from '../../../sheets/src/main/sheets-main'
import { requestSlidesClose } from '../../../slides/src/main/slides-main'
import { requestPdfClose } from '../../../pdf/src/main/pdf-main'
import { requestMarkdownClose } from '../../../markdown/src/main/markdown-main'
import { requestHtmlClose } from '../../../html/src/main/html-main'
import type { TabManager } from './tab-manager'
import { confirmUniworkClose } from './uniwork-docs/close-guard'

/**
 * The app-quit side of the guard. Cancelling a window's close event also
 * cancels an in-flight app.quit(); on macOS, where closing the last window does
 * not quit, ⌘Q from a tab that needs the async prompt path (any docs tab) would
 * then close the window and leave the app running. With this wired in, a
 * confirmed close re-issues the quit instead of just the window close.
 */
export interface QuitFlight {
  /** an app quit (⌘Q, Dock / app menu Quit) is in progress */
  inFlight(): boolean
  /** the quit was vetoed (a prompt was cancelled or failed) */
  clear(): void
  /** re-issue the quit once every prompt has been answered */
  resume(): void
}

/**
 * Unsaved-changes guard for the shell window: closing the whole window walks
 * every dirty sheets/pdf/slides/docs tab through the same
 * save/don't-save/cancel prompt the tab close path uses, and any cancel
 * aborts the close. docs dirtiness lives renderer-side, so any live docs tab
 * forces the async path and gets queried there (clean tabs pass through
 * without activation).
 *
 * Cancelling the close event also cancels an in-flight app.quit(), and on
 * macOS window-all-closed does not quit, so once the prompts have all been
 * confirmed a close that began as a quit must be finished with app.quit()
 * rather than win.close(): the latter closes the only window and leaves the
 * app running with none (genoffice#2098, ⌘Q needing two presses whenever a
 * Docs tab is open).
 *
 * Installed separately from index.ts (same helpers as the detached-window
 * guard) so the handler itself stays unit-testable: it takes the window, the
 * tab manager and the quit tracker as arguments and therefore needs no
 * Electron to run.
 */
<<<<<<< ours
export function installShellCloseGuard(
  win: BrowserWindow,
  manager: TabManager,
  quit?: QuitFlight,
=======
export interface QuitTracker {
  /** a quit is in progress: between before-quit and its windows' close events */
  quitting(): boolean
  /** keep quitting() alive past the close event while prompts run */
  hold(): void
  release(): void
  /** the quit was cancelled: a prompt was denied */
  reset(): void
  quit(): void
}

/**
 * Electron fires no event for a cancelled quit, so the flag may not stay
 * latched: it is true only during the synchronous window-close pass that
 * app.quit() runs (cleared on the next macrotask) unless a guard that
 * prevented one of those closes holds it while its prompts are open.
 */
function electronQuitTracker(): QuitTracker {
  let quitting = false
  let holds = 0
  app.on('before-quit', () => {
    quitting = true
    setImmediate(() => {
      if (holds === 0) quitting = false
    })
  })
  return {
    quitting: () => quitting,
    hold: () => {
      holds += 1
    },
    release: () => {
      holds -= 1
      if (holds === 0) quitting = false
    },
    reset: () => {
      quitting = false
    },
    quit: () => app.quit(),
  }
}

let shared: QuitTracker | undefined

export function shellQuitTracker(): QuitTracker {
  return (shared ??= electronQuitTracker())
}

export function installShellCloseGuard(
  win: BrowserWindow,
  manager: TabManager,
  quitTracker: QuitTracker = shellQuitTracker(),
>>>>>>> theirs
): void {
  let closeConfirmed = false
  // a second close event while the save prompts are still open (double ⌘Q, an
  // OS retry) must not re-enter the whole prompt chain
  let closePromptInFlight = false
  let holdingQuit = false

  win.on('close', (event) => {
    if (closeConfirmed) return
    const dirtySheets = manager.dirtySheetsTabs()
    const dirtyPdf = manager.dirtyPdfTabs()
    const dirtyMarkdown = manager.dirtyMarkdownTabs()
    const dirtyHtml = manager.dirtyHtmlTabs()
    const dirtySlides = manager.dirtySlidesTabs()
    const docsTabs = manager.docsTabs()
    const uniworkTabs = manager.uniworkGuardedTabs()
    // Nothing to protect, so let this close event through untouched. Cancelling
    // it and re-issuing win.close() would also cancel an in-flight app.quit();
    // on macOS, where window-all-closed does not quit, ⌘Q with a clean
    // document would then close the only window and leave the app running
    // with none.
    if (
      dirtySheets.length === 0 &&
      dirtyPdf.length === 0 &&
      dirtyMarkdown.length === 0 &&
      dirtyHtml.length === 0 &&
      dirtySlides.length === 0 &&
      docsTabs.length === 0 &&
      uniworkTabs.length === 0
    ) {
      return
    }
    // Only the branch that is about to prompt cancels the close. The debounce
    // below still needs that cancel before it returns, or a second close
    // would land on top of the prompt that is already open.
    event.preventDefault()
    // a ⌘Q that lands while a red-button prompt is already open still turns
    // that close into a quit
    if (quitTracker.quitting() && !holdingQuit) {
      holdingQuit = true
      quitTracker.hold()
    }
    if (closePromptInFlight) return
    closePromptInFlight = true
    void (async () => {
      try {
        const denied = await (async () => {
          for (const tab of dirtySheets) {
            manager.activateTab(tab.id)
            if (!(await requestSheetsClose(tab.webContents, win))) return true
          }
          for (const tab of dirtyPdf) {
            manager.activateTab(tab.id)
            if (!(await requestPdfClose(tab.webContents, win))) return true
          }
          for (const tab of dirtyMarkdown) {
            manager.activateTab(tab.id)
            if (!(await requestMarkdownClose(tab.webContents, win))) return true
          }
          for (const tab of dirtyHtml) {
            manager.activateTab(tab.id)
            if (!(await requestHtmlClose(tab.webContents, win))) return true
          }
          for (const tab of dirtySlides) {
            manager.activateTab(tab.id)
            if (!(await requestSlidesClose(tab.webContents, win))) return true
          }
          for (const tab of docsTabs) {
            if (!(await docsQueryDirty(tab.webContents))) continue
            manager.activateTab(tab.id)
            if (!(await requestDocsClose(tab.webContents, win))) return true
          }
          // after the module prompts: local changes not in UniWork yet
          for (const tab of uniworkTabs) {
            if (!(await confirmUniworkClose(tab.path))) {
              manager.activateTab(tab.id)
              return true
            }
          }
          return false
        })()
        // a denied close vetoes any quit that was in flight: the sheets close
        // guard must prompt again on later closes instead of silently proceeding
        if (denied) {
<<<<<<< ours
          resetSheetsShuttingDown()
          quit?.clear()
        } else {
          closeConfirmed = true
          // the cancelled close took the in-flight quit down with it: ask for it
          // again, or on macOS only the window goes and the app keeps running
          if (quit?.inFlight()) quit.resume()
          else if (!win.isDestroyed()) win.close()
=======
          quitTracker.reset()
          resetSheetsShuttingDown()
        } else {
          closeConfirmed = true
          if (win.isDestroyed()) return
          // read now, not at the close event: a detached window may have vetoed
          // the quit in the meantime
          if (quitTracker.quitting()) quitTracker.quit()
          else win.close()
>>>>>>> theirs
        }
      } catch (err) {
        // a throw aborts the close like a denial: the window stays open, so the
        // quit that may have latched sheets as shutting down is vetoed too
        console.error('[shell] window close prompt failed:', err)
        quitTracker.reset()
        resetSheetsShuttingDown()
        quit?.clear()
      } finally {
        closePromptInFlight = false
        if (holdingQuit) {
          holdingQuit = false
          quitTracker.release()
        }
      }
    })()
  })
}
