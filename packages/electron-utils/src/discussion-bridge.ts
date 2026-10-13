/// G8-11 (UNI-1406): preload half of the shell Discussion panel seam (see
/// ./comments-ipc DISCUSSION_CHANNELS). Installed by the SHELL preload only:
/// the panel lives in the shell renderer and serves every editor tab, so the
/// six editor preloads keep their own `window.uniworkComments` and never get
/// this one. Like ./comments-bridge every call resolves to the serializable
/// CommentsReply envelope unchanged (R1-1); the renderer unwraps it in its own
/// realm. `onReveal(path)` arms main's push for that path and pulls the reveal
/// main held for it; the unsubscribe disarms it again.
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { DISCUSSION_BRIDGE_KEY, DISCUSSION_CHANNELS, parseCommentsReveal } from './comments-ipc'
import type { CommentsReply, UniworkDiscussionApi } from './comments-ipc'

async function call<T>(channel: string, input: unknown): Promise<CommentsReply<T>> {
  return (await ipcRenderer.invoke(channel, input)) as CommentsReply<T>
}

export function createUniworkDiscussionApi(): UniworkDiscussionApi {
  return {
    list: (input) => call(DISCUSSION_CHANNELS.list, input),
    create: (input) => call(DISCUSSION_CHANNELS.create, input),
    update: (input) => call(DISCUSSION_CHANNELS.update, input),
    remove: (input) => call(DISCUSSION_CHANNELS.remove, input),
    resolve: (input) => call(DISCUSSION_CHANNELS.resolve, input),
    reopen: (input) => call(DISCUSSION_CHANNELS.reopen, input),
    revisions: (input) => call(DISCUSSION_CHANNELS.revisions, input),
    searchMentions: (input) => call(DISCUSSION_CHANNELS.searchMentions, input),
    onReveal: (path, handler) => {
      // same race rules as the editor bridge: the listener is armed before
      // the pull, a push that lands while the pull is in flight supersedes its
      // answer (D1-2), and an answer after the unsubscribe is dropped (D1-3)
      let pulling = true
      let superseded = false
      let inactive = false
      const listener = (_event: IpcRendererEvent, payload: unknown) => {
        const reveal = parseCommentsReveal(payload)
        if (!reveal || reveal.path !== path) return
        if (pulling) superseded = true
        handler(reveal.commentId)
      }
      ipcRenderer.on(DISCUSSION_CHANNELS.reveal, listener)
      void ipcRenderer.invoke(DISCUSSION_CHANNELS.revealPending, { path }).then(
        (pending: unknown) => {
          pulling = false
          if (inactive || superseded) return
          const reveal = parseCommentsReveal(pending)
          if (reveal && reveal.path === path) handler(reveal.commentId)
        },
        () => {
          pulling = false
        },
      )
      return () => {
        if (inactive) return
        inactive = true
        ipcRenderer.removeListener(DISCUSSION_CHANNELS.reveal, listener)
        ipcRenderer.send(DISCUSSION_CHANNELS.revealRelease, { path })
      }
    },
    setPanel: (input) => {
      ipcRenderer.send(DISCUSSION_CHANNELS.panel, { open: input.open, width: input.width })
    },
  }
}

export function installUniworkDiscussionBridge(): void {
  contextBridge.exposeInMainWorld(DISCUSSION_BRIDGE_KEY, createUniworkDiscussionApi())
}

export type { UniworkDiscussionApi }
