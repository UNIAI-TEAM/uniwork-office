/**
 * G8-08 (UNI-1403): the comment reload rules of contract §4.7 / §7 for the
 * desktop editor, as a pure scheduler with injected timers. Pure (no Electron,
 * no React) so the renderer and the tests can drive it with fake timers.
 *
 * The rule: poll ONLY while the tab is visible AND the panel is open; on every
 * focus and every 30 s send `since_token` = the last `list_token` received. An
 * `unchanged` answer draws nothing; any other answer replaces the WHOLE list
 * (so a hard-deleted thread vanishes); the composer draft is never touched
 * (it lives in the renderer, this module never sees it). When the tab is hidden
 * or the panel closes, polling stops and the timer is cleared.
 */

export const COMMENTS_POLL_INTERVAL_MS = 30_000

export interface CommentsPollState {
  /** the panel is open (the editor shows the comment list) */
  panelOpen: boolean
  /** the tab is visible (document.visibilityState === 'visible') */
  visible: boolean
  /** the last `list_token` received, or null before the first successful list */
  sinceToken: string | null
}

/** one `comments.list` call: returns the server's answer for the scheduler to interpret */
export type CommentsPollFetch = (input: {
  sinceToken: string | null
}) => Promise<{ unchanged: true; listToken: string } | { unchanged: false; listToken: string }>

export interface CommentsPollDeps {
  fetch(input: {
    sinceToken: string | null
  }): Promise<{ unchanged: true; listToken: string } | { unchanged: false; listToken: string }>
  /**
   * The whole list replaced (a non-`unchanged` answer). The renderer redraws
   * and remembers the token. Never called for `unchanged`.
   */
  onChanged(listToken: string): void
  /** a poll failed; the editor keeps its list (no redraw, no error toast) */
  onError?(error: unknown): void
  now?(): number
  setTimer?(fn: () => void, ms: number): ReturnType<typeof setTimeout>
  clearTimer?(handle: ReturnType<typeof setTimeout>): void
  intervalMs?: number
}

export interface CommentsPoll {
  /** the tab visibility changed */
  setVisible(visible: boolean): void
  /** the panel opened or closed */
  setPanelOpen(open: boolean): void
  /** the editor asks for a reload now (tab focus, a `comments.changed`, after a write) */
  reload(): void
  /** true while a poll may run (panel open and tab visible) */
  active(): boolean
  dispose(): void
}

/** true when a poll may run: panel open AND tab visible */
export function commentsPollActive(
  state: Pick<CommentsPollState, 'panelOpen' | 'visible'>,
): boolean {
  return state.panelOpen && state.visible
}

export function createCommentsPoll(deps: CommentsPollDeps): CommentsPoll {
  const intervalMs = deps.intervalMs ?? COMMENTS_POLL_INTERVAL_MS
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle))
  let state: CommentsPollState = { panelOpen: false, visible: true, sinceToken: null }
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false
  let disposed = false

  const clear = (): void => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  const schedule = (): void => {
    clear()
    if (disposed || !commentsPollActive(state)) return
    timer = setTimer(() => {
      timer = null
      void poll()
      schedule()
    }, intervalMs)
  }

  async function poll(): Promise<void> {
    if (disposed || inFlight || !commentsPollActive(state)) return
    inFlight = true
    try {
      const answer = await deps.fetch({ sinceToken: state.sinceToken })
      if (disposed) return
      state = { ...state, sinceToken: answer.listToken }
      if (!answer.unchanged) deps.onChanged(answer.listToken)
    } catch (error) {
      if (!disposed) deps.onError?.(error)
    } finally {
      inFlight = false
    }
  }

  return {
    setVisible(visible) {
      if (state.visible === visible) return
      state = { ...state, visible }
      if (commentsPollActive(state)) {
        void poll()
        schedule()
      } else {
        clear()
      }
    },
    setPanelOpen(open) {
      if (state.panelOpen === open) return
      state = { ...state, panelOpen: open }
      if (commentsPollActive(state)) {
        void poll()
        schedule()
      } else {
        clear()
      }
    },
    reload() {
      if (!commentsPollActive(state)) return
      void poll()
      schedule()
    },
    active() {
      return commentsPollActive(state)
    },
    dispose() {
      disposed = true
      clear()
    },
  }
}
