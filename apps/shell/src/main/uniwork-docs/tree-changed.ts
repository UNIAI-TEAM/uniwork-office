/**
 * FD-11 (UNI-1809): the coalescer behind `uniwork-doc:tree-changed`.
 *
 * Two very different sources report a workspace's tree as stale - the change
 * feed (one notice per committed page) and this app's own folder actions - and
 * a burst of them (a folder move plus its feed echo, a snapshot's page after
 * page) must not make the renderer re-read the tree repeatedly. Every caller
 * only names a workspace id; the first notice opens a window of `windowMs`
 * (default 500), every notice inside it joins, and the window's end pushes one
 * event. A second change after that window opens a new one, so a workspace
 * never sees more than one push per window while a real burst is still seen.
 *
 * Ids only: a title or a path never reaches this module (no-PII rule).
 */

export const TREE_CHANGED_WINDOW_MS = 500

export interface UniworkTreeChangedCoalescer {
  /** something in this workspace's tree changed; one push per window at most */
  notify(workspaceId: string): void
  /** the session is going away: forget every pending window without pushing */
  cancel(): void
}

export interface UniworkTreeChangedOptions {
  emit(workspaceId: string): void
  /** window length in ms (default `TREE_CHANGED_WINDOW_MS`) */
  windowMs?: number
  /** test seam: schedule `run` after `ms`, returning the cancel */
  schedule?(run: () => void, ms: number): () => void
}

const defaultSchedule = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms)
  // a pending window must not hold the app open
  ;(timer as { unref?: () => void }).unref?.()
  return () => clearTimeout(timer)
}

export function createTreeChangedCoalescer(
  options: UniworkTreeChangedOptions,
): UniworkTreeChangedCoalescer {
  const windowMs = options.windowMs ?? TREE_CHANGED_WINDOW_MS
  const schedule = options.schedule ?? defaultSchedule
  /** workspace id -> the cancel of the window it is waiting on */
  const windows = new Map<string, () => void>()

  return {
    notify(workspaceId) {
      if (typeof workspaceId !== 'string' || !workspaceId) return
      // a window is already open for this workspace: this notice joins it
      if (windows.has(workspaceId)) return
      const cancel = schedule(() => {
        // the window is over before the push: a throwing emit must not leave the
        // workspace stuck without one, and the next change opens a fresh window
        windows.delete(workspaceId)
        options.emit(workspaceId)
      }, windowMs)
      windows.set(workspaceId, cancel)
    },
    cancel() {
      for (const cancel of windows.values()) cancel()
      windows.clear()
    },
  }
}
