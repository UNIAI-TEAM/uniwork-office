import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { uniworkBoundForAi } from '@genoffice/ui/capabilities'
import { platform } from './capabilities'
import { noteEditableIntent } from './editor/editable-intent'

/**
 * UniWork seam, renderer half. The main process answers whether the open file
 * is a UniWork working copy (bound: file autosave is forced off, Save always
 * writes) and whether the user may only view it. A plain local file (or no
 * shell policy) reads as neither, so nothing changes.
 */
export interface UniworkDocState {
  /** the path this answer belongs to: a stale answer never applies to a new path */
  path: string | null
  bound: boolean
  readOnly: boolean
}

export const NO_UNIWORK_STATE: UniworkDocState = { path: null, bound: false, readOnly: false }

/** the answer for `path`, or "plain local file" while it is unknown / for another path */
export function uniworkStateFor(
  state: UniworkDocState,
  path: string | null | undefined,
): { bound: boolean; readOnly: boolean } {
  if (!path || state.path !== path) return { bound: false, readOnly: false }
  return { bound: state.bound, readOnly: state.readOnly }
}

/**
 * The bound answer the AI layer reads (the docs-skill C-BOUND filter): the
 * shared `uniworkBoundForAi` rule with this app's capability platform. A web
 * frame IS the UniWork document, but its adapter still answers `bound: false`:
 * the save path, autosave and the Save button key off the working-copy state.
 * Feed the AI only — `uniwork.bound` keeps its other (non-AI) meanings.
 */
export function docsUniworkBoundForAi(bound: boolean): boolean {
  return uniworkBoundForAi(bound, platform())
}

/**
 * Whether a renderer save request may run. Autosave never runs on a bound
 * document; an in-place Save never runs on a view-only one (Save As to
 * another path stays allowed and produces a plain local copy). Saves of a
 * pathless document are never gated: it cannot be a UniWork document.
 */
export function uniworkAllowsSave(
  state: { bound: boolean; readOnly: boolean },
  saveAs: boolean,
  auto: boolean,
): boolean {
  if (saveAs) return true
  if (state.readOnly) return false
  if (auto && state.bound) return false
  return true
}

/**
 * EL-1(b) fix10: whether the document held unsaved edits while it was still
 * editable. Updated on every render: editable renders follow the live dirty
 * state, read-only renders keep the last editable answer, so edits held when
 * the lock is lost in place are remembered (AC-3 "edits kept") while a copy
 * opened view-only never starts remembering any.
 *
 * EL-1(b) fix11 (EL1B-FE-R3-2): an edit sets the live dirty flag before its
 * re-render runs, so the first render that sees it can already be the
 * read-only one. The editable -> read-only render (`wasReadOnly` false)
 * therefore samples the live `dirty` instead of keeping `previous`.
 */
export function nextDirtyWhileEditable(
  previous: boolean,
  readOnly: boolean,
  dirty: boolean,
  wasReadOnly: boolean = readOnly,
): boolean {
  if (!readOnly) return dirty
  return wasReadOnly ? previous : dirty
}

/**
 * The held-edits memory as a ref the close guard reads, updated on every
 * render from `nextDirtyWhileEditable` and the previous render's read-only.
 */
export function useDirtyWhileEditable(
  readOnly: boolean,
  dirty: boolean,
): MutableRefObject<boolean> {
  const held = useRef(false)
  const wasReadOnly = useRef(readOnly)
  held.current = nextDirtyWhileEditable(held.current, readOnly, dirty, wasReadOnly.current)
  wasReadOnly.current = readOnly
  return held
}

/**
 * Close-guard dirty report. A copy opened view-only has nothing to ask about
 * (it cannot be saved in place), but one that lost its edit rights while
 * holding unsaved edits must still prompt, or closing drops them silently.
 */
export function uniworkCloseDirty(
  readOnly: boolean,
  dirtyWhileEditable: boolean,
  dirty: boolean,
): boolean {
  return dirty && (!readOnly || dirtyWhileEditable)
}

/**
 * Whether the AutoSave switch is shown. A UniWork document is written only by
 * an explicit Save (product rule), so it has no AutoSave switch at all, not
 * even a disabled one. A plain local file keeps it where the platform has a
 * local path to write.
 */
export function autoSaveToggleVisible(platformAutoSave: boolean, bound: boolean): boolean {
  return platformAutoSave && !bound
}
/**
 * EL-1(b): the preload surface the shell adds for the desktop edit lock
 * (uniwork:doc-state-changed ping + the read-only-save explain route). Both
 * members stay optional here: a web bridge or an older shell never defines
 * them, and the renderer then behaves exactly as before the lock existed.
 */
export interface UniworkLockSeam {
  /** pushed with the affected document path; return value unsubscribes */
  onUniworkStateChanged?(cb: (path: string) => void): () => void
  /** explicit Save of a read-only bound document: main explains, never writes */
  uniworkReadOnlySave?(path?: string): Promise<void>
}

/** Query main for the document at `path`; re-queried whenever the path changes. */
export function useUniworkDocState(path: string | null | undefined): UniworkDocState {
  const [state, setState] = useState<UniworkDocState>(NO_UNIWORK_STATE)
  useEffect(() => {
    if (!path) {
      setState(NO_UNIWORK_STATE)
      return
    }
    let live = true
    const query = () => {
      const request = window.desktop.uniworkState?.(path)
      if (!request) return
      request.then(
        (answer) => {
          if (!live) return
          setState({ path, bound: answer?.bound === true, readOnly: answer?.readOnly === true })
        },
        () => {
          /* no answer: keep treating it as a plain local file */
        },
      )
    }
    query()
    // EL-1(b): the edit lock makes bound/read-only change while the document
    // stays open; the shell pings the affected path. Other paths' pings never
    // touch this document's answer.
    const seam = window.desktop as UniworkLockSeam
    const unsubscribe = seam.onUniworkStateChanged?.((p) => {
      if (p === path) query()
    })
    return () => {
      live = false
      unsubscribe?.()
    }
  }, [path])
  return state
}

/**
 * EL-1(b) VEL-1: an explicit Save (Ctrl+S, File > Save, toolbar Save) on a
 * read-only *bound* document asks the shell to explain the lock instead of
 * silently doing nothing. Autosave and Save As never explain (autosave is
 * not a user gesture; Save As writes a plain local copy). A read-only local
 * file or an absent seam keeps today's behaviour.
 */
export function uniworkExplainReadOnlySave(
  seam: UniworkLockSeam | null | undefined,
  state: { bound: boolean; readOnly: boolean },
  saveAs: boolean,
  auto: boolean,
  path: string | null | undefined,
): void {
  if (saveAs || auto || !state.bound || !state.readOnly) return
  void seam?.uniworkReadOnlySave?.(path ?? undefined)?.catch(() => {
    /* the explain route is best-effort: the lock still blocks the write */
  })
}

/**
 * Switch the editor between editable and read-only without counting it as an
 * edit. TipTap's setEditable emits `update` by default, and the renderer's
 * onUpdate marks the document dirty: a view-only UniWork document (switched
 * to read-only once main answers) would open as "Unsaved changes".
 */
export function setEditorEditable(
  editor: { setEditable(editable: boolean, emitUpdate?: boolean): void },
  editable: boolean,
): void {
  noteEditableIntent(editor, editable)
  editor.setEditable(editable, false)
}

/**
 * Footer save-state label: a view-only document is never "unsaved", it has no
 * save state. A clean UniWork copy shows none: whether its last Save reached
 * UniWork (saved, conflict, offline, signed out) is the title-bar chip's to
 * say, and a local "All changes saved" would contradict it. A converted legacy copy that has not
 * had its first Save As (`neverSaved`) is an unsaved document, not a saved one.
 */
export function saveStateLabel(
  hasUnsavedChanges: boolean,
  readOnly: boolean,
  bound = false,
  neverSaved = false,
): {
  key: 'appSaveStateViewOnly' | 'appSaveStateUnsaved' | 'appSaveStateSaved'
  unsaved: boolean
} | null {
  if (readOnly) return { key: 'appSaveStateViewOnly', unsaved: false }
  if (hasUnsavedChanges) return { key: 'appSaveStateUnsaved', unsaved: true }
  if (bound) return null
  return neverSaved
    ? { key: 'appSaveStateUnsaved', unsaved: true }
    : { key: 'appSaveStateSaved', unsaved: false }
}
