/**
 * Feeds the editors' unsaved-edit and AI-turn state of UniWork working copies
 * to the service, so the title-bar chip shows "Unsaved changes" as soon as the
 * user types (the binding only learns about bytes once a Save writes them) and
 * the S6 bar can hold a clean reload while a turn runs. The modules expose that
 * state differently (docs answers over IPC, the others synchronously), so the
 * shell asks on an interval instead of each module pushing it. Needs no
 * Electron runtime: index.ts injects the tab reader.
 */
import type { EditorState } from '../ai-run-registry'

export const EDITOR_STATE_POLL_MS = 1000

export interface EditorStatePollDeps {
  /**
   * every open view of a file `wanted` accepts — tabs and detached windows
   * (the same path may appear once per view); dirty null = the editor did not
   * answer
   */
  editorDirtyStates(wanted: (path: string) => boolean): Promise<EditorState[]>
  isBound(path: string): boolean
  /** a counter that moves on every user Save: read before a pass asks the editors */
  saveMark(): number
  /**
   * One merged state per path. `dirty` is null only when every view of the path
   * answered null; `aiRunning` is any view running; `aiEpoch` is the sum of the
   * views' epochs. `mark` is the saveMark read before the pass that produced it.
   */
  noteEditorState(path: string, state: Omit<EditorState, 'path'>, mark: number): void
}

/**
 * One state per path out of the per-view answers: `dirty` is true when any view
 * says so, false when a view answered false and none says true, and null only
 * when every view stayed silent (the service keeps what it last knew);
 * `aiRunning` is true when any view runs a turn; `aiEpoch` is the sum, so a turn
 * on any view of the document moves the epoch the guarded reload compares.
 */
export function mergeEditorStates(states: EditorState[]): EditorState[] {
  const byPath = new Map<string, EditorState>()
  for (const state of states) {
    const merged = byPath.get(state.path)
    if (!merged) {
      byPath.set(state.path, { ...state })
      continue
    }
    if (state.dirty === true) merged.dirty = true
    else if (state.dirty === false && merged.dirty !== true) merged.dirty = false
    merged.aiRunning = merged.aiRunning || state.aiRunning
    merged.aiEpoch += state.aiEpoch
  }
  return [...byPath.values()]
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
      for (const { path, dirty, aiRunning, aiEpoch } of mergeEditorStates(states)) {
        deps.noteEditorState(path, { dirty, aiRunning, aiEpoch }, mark)
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
