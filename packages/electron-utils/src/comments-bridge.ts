/// Preload half of the UniWork comments seam (see ./comments-ipc): exposes
/// window.uniworkComments, which forwards the editor's comment calls to the
/// shell main process over the COMMENTS_CHANNELS invoke channels and RESOLVES
/// to the serializable CommentsReply envelope unchanged. R1-1: Electron's
/// contextBridge deep-clones every value crossing it and keeps only `message`
/// of a thrown Error, so the preload must never rehydrate and throw a
/// DocsProtocolError - the renderer unwraps the envelope in its own realm
/// (./comments-reply). It also hands the main process's reveal pushes to the
/// editor and pulls the one held for this window on the first subscribe.
/// Called once from every editor preload, so all six apps expose the same
/// surface.
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  COMMENTS_BRIDGE_KEY,
  COMMENTS_CHANNELS,
  parseCommentsReveal,
  parseCommentsSaved,
} from './comments-ipc'
import type {
  CommentsContextResult,
  CommentsRevealPayload,
  CommentsReply,
  CommentsSavedPayload,
  UniworkCommentsApi,
} from './comments-ipc'

async function call<T>(channel: string, input: unknown): Promise<CommentsReply<T>> {
  return (await ipcRenderer.invoke(channel, input)) as CommentsReply<T>
}

export function createUniworkCommentsApi(): UniworkCommentsApi {
  return {
    list: (input) => call(COMMENTS_CHANNELS.list, input),
    create: (input) => call(COMMENTS_CHANNELS.create, input),
    update: (input) => call(COMMENTS_CHANNELS.update, input),
    remove: (input) => call(COMMENTS_CHANNELS.remove, input),
    resolve: (input) => call(COMMENTS_CHANNELS.resolve, input),
    reopen: (input) => call(COMMENTS_CHANNELS.reopen, input),
    revisions: (input) => call(COMMENTS_CHANNELS.revisions, input),
    anchors: (input) => call(COMMENTS_CHANNELS.anchors, input),
    searchMentions: (input) => call(COMMENTS_CHANNELS.searchMentions, input),
    onReveal: (handler) => {
      // R1-2: main holds the latest reveal per path until its editor
      // subscribes. The listener is armed before the pull, so a reveal decided
      // while the pull is in flight is pushed here; it supersedes the pull
      // answer (D1-2), which would otherwise restore the older thread.
      let pulling = true
      let superseded = false
      let inactive = false
      const listener = (_event: IpcRendererEvent, payload: unknown) => {
        const reveal = parseCommentsReveal(payload)
        if (!reveal) return
        if (pulling) superseded = true
        handler(reveal)
      }
      ipcRenderer.on(COMMENTS_CHANNELS.reveal, listener)
      void ipcRenderer.invoke(COMMENTS_CHANNELS.revealPending).then(
        (pending: unknown) => {
          pulling = false
          // D1-3: the unsubscribe may have run while the pull was in flight
          if (inactive || superseded) return
          const reveal = parseCommentsReveal(pending)
          if (reveal) handler(reveal)
        },
        () => {
          pulling = false
        },
      )
      return () => {
        inactive = true
        ipcRenderer.removeListener(COMMENTS_CHANNELS.reveal, listener)
      }
    },
    context: (input) => call<CommentsContextResult>(COMMENTS_CHANNELS.context, input),
    onSaved: (handler) => {
      // G8-12: nothing is held for a late subscriber - the editor reads the
      // current version through context() when it mounts
      const listener = (_event: IpcRendererEvent, payload: unknown) => {
        const saved = parseCommentsSaved(payload)
        if (saved) handler(saved)
      }
      ipcRenderer.on(COMMENTS_CHANNELS.saved, listener)
      return () => {
        ipcRenderer.removeListener(COMMENTS_CHANNELS.saved, listener)
      }
    },
  }
}

export function installUniworkCommentsBridge(): void {
  contextBridge.exposeInMainWorld(COMMENTS_BRIDGE_KEY, createUniworkCommentsApi())
}

export type { CommentsRevealPayload, CommentsSavedPayload, UniworkCommentsApi }
