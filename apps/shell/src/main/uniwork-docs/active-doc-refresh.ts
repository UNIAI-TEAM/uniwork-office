/**
 * S18 (G8-17): the triggers that re-read the active UniWork document when the
 * user comes back to it, so a title changed on the web shows on the desktop
 * without waiting for the 60 s change feed.
 *
 * A tab switch (the active path changed) also tells the service which document
 * is active, which closes a conflict dialog of another one. A focus on the
 * same document - the window regaining focus, a click on the tab that is
 * already active - only re-reads it.
 */

export interface ActiveDocRefreshDeps {
  noteActivePath(path: string | undefined): void
  refreshPath(path: string | undefined): Promise<void>
}

export interface ActiveDocRefresh {
  /** the tab manager changed: act only when the active path moved */
  tabsChanged(active: string | undefined): void
  /** the window or the active tab gained focus: re-read that document */
  gainedFocus(active: string | undefined): void
}

export function createActiveDocRefresh(deps: ActiveDocRefreshDeps): ActiveDocRefresh {
  let lastActive: string | undefined
  const refresh = (path: string | undefined): void => {
    void deps.refreshPath(path).catch(() => undefined)
  }
  return {
    tabsChanged(active) {
      if (active === lastActive) return
      lastActive = active
      // a conflict dialog names one document: it closes when that tab is left
      deps.noteActivePath(active)
      refresh(active)
    },
    gainedFocus(active) {
      if (active) refresh(active)
    },
  }
}
