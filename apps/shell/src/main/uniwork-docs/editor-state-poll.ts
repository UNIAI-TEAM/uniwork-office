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
  noteEditorDirty(path: string, dirty: boolean): void
}

/** One pass; a pass still waiting on a busy editor is never overlapped. */
export function createEditorStatePoll(deps: EditorStatePollDeps): () => Promise<void> {
  let running = false
  return async () => {
    if (running) return
    running = true
    try {
      const states = await deps.editorDirtyStates((path) => deps.isBound(path))
      for (const { path, dirty } of states) {
        if (dirty !== null) deps.noteEditorDirty(path, dirty)
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
