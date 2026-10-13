/**
 * The server version of the document a frame has open (lane contract G8-12 §3.3): the anchor base
 * of a new root comment and the version a post-Save anchor map refers to.
 *
 * The module bridges feed it: every file they open, reload or adopt (`remember`) is noted
 * silently, and a save that landed (Docs `webapi.ts landed()`, Sheets `saveWorkbookEdits`) is
 * noted as saved, which also tells the `onSaved` listeners (`window.uniworkComments.onSaved` on
 * the web). One frame shows one document, so the bridges share the module-level `frameDocVersion`.
 */

export interface FrameDocVersionState {
  /** the bridge path of the open file (`pathFor(file)`), null before the first open */
  path: string | null
  /** its server version id, null while unknown */
  versionId: string | null
}

export interface FrameDocSaved {
  path: string
  versionId: string
}

export interface FrameDocVersion {
  current(): FrameDocVersionState
  /** the frame opened, reloaded or adopted this file: updates the state, tells nobody */
  noteOpened(file: { path: string; versionId?: string | null }): void
  /** a save landed on this file: updates the state and tells the listeners (when the id is known) */
  noteSaved(file: { path: string; versionId?: string | null }): void
  /** returns the unsubscribe */
  onSaved(listener: (saved: FrameDocSaved) => void): () => void
}

export function createFrameDocVersion(): FrameDocVersion {
  let state: FrameDocVersionState = { path: null, versionId: null }
  const listeners = new Set<(saved: FrameDocSaved) => void>()
  const note = (file: { path: string; versionId?: string | null }): void => {
    state = { path: file.path, versionId: file.versionId ? file.versionId : null }
  }
  return {
    current: () => ({ ...state }),
    noteOpened: note,
    noteSaved(file) {
      note(file)
      const { path, versionId } = state
      if (path === null || versionId === null) return
      for (const listener of [...listeners]) {
        try {
          listener({ path, versionId })
        } catch (err) {
          // one panel's failure must not keep the others from the new version
          console.error('[comments] saved listener failed:', err)
        }
      }
    },
    onSaved(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** the one tracker of this frame page */
export const frameDocVersion: FrameDocVersion = createFrameDocVersion()
