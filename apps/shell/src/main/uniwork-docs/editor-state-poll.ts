/**
 * Feeds the editors' unsaved-edit state of UniWork working copies to the
 * service, so the title-bar chip shows "Unsaved changes" as soon as the user
 * types (the binding only learns about bytes once a Save writes them). The
 * modules expose that state differently (docs answers over IPC, the others
 * synchronously), so the shell asks on an interval instead of each module
 * pushing it. Needs no Electron runtime: index.ts injects the tab reader.
 */

export const EDITOR_STATE_POLL_MS = 1000

export interface EditorStatePollDeps {
  /** every open tab of a file `wanted` accepts; dirty null = the editor did not answer */
  editorDirtyStates(
    wanted: (path: string) => boolean,
  ): Promise<Array<{ path: string; dirty: boolean | null }>>
  isBound(path: string): boolean
  /** a counter that moves on every user Save: read before a pass asks the editors */
  saveMark(): number
  /** `mark` is the saveMark read before the pass that produced this answer */
  noteEditorDirty(path: string, dirty: boolean, mark: number): void
}

/** One pass; a pass still waiting on a busy editor is never overlapped. */
export function createEditorStatePoll(deps: EditorStatePollDeps): () => Promise<void> {
  let running = false
  return async () => {
    if (running) return
    running = true
    try {
      // a Save that lands while the editors are asked makes the answer stale
      const mark = deps.saveMark()
      const states = await deps.editorDirtyStates((path) => deps.isBound(path))
      for (const { path, dirty } of states) {
        if (dirty !== null) deps.noteEditorDirty(path, dirty, mark)
      }
    } catch {
      // a tab closing mid-pass: the next pass reads the tabs again
    } finally {
      running = false
    }
  }
}

export function startEditorStatePoll(
  deps: EditorStatePollDeps,
  intervalMs = EDITOR_STATE_POLL_MS,
): () => void {
  const pass = createEditorStatePoll(deps)
  const timer = setInterval(() => void pass(), intervalMs)
  ;(timer as { unref?: () => void }).unref?.()
  return () => clearInterval(timer)
}
