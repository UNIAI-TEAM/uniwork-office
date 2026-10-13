/// Preload half of the UniWork comments seam (see ./comments-ipc): exposes
/// window.uniworkComments, which forwards the editor's comment calls to the
/// shell main process over the COMMENTS_CHANNELS invoke channels and hands the
/// main process's reveal pushes to the editor. Called once from every editor
/// preload, so all six apps expose the same surface.
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { COMMENTS_BRIDGE_KEY, COMMENTS_CHANNELS, parseCommentsReveal } from './comments-ipc'
import type { CommentsRevealPayload, UniworkCommentsApi } from './comments-ipc'

export function createUniworkCommentsApi(): UniworkCommentsApi {
  return {
    list: (input) => ipcRenderer.invoke(COMMENTS_CHANNELS.list, input),
    create: (input) => ipcRenderer.invoke(COMMENTS_CHANNELS.create, input),
    update: (input) => ipcRenderer.invoke(COMMENTS_CHANNELS.update, input),
    remove: (input) => ipcRenderer.invoke(COMMENTS_CHANNELS.remove, input),
    resolve: (input) => ipcRenderer.invoke(COMMENTS_CHANNELS.resolve, input),
    reopen: (input) => ipcRenderer.invoke(COMMENTS_CHANNELS.reopen, input),
    revisions: (input) => ipcRenderer.invoke(COMMENTS_CHANNELS.revisions, input),
    anchors: (input) => ipcRenderer.invoke(COMMENTS_CHANNELS.anchors, input),
    searchMentions: (input) => ipcRenderer.invoke(COMMENTS_CHANNELS.searchMentions, input),
    onReveal: (handler) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) => {
        const reveal = parseCommentsReveal(payload)
        if (reveal) handler(reveal)
      }
      ipcRenderer.on(COMMENTS_CHANNELS.reveal, listener)
      return () => ipcRenderer.removeListener(COMMENTS_CHANNELS.reveal, listener)
    },
  }
}

export function installUniworkCommentsBridge(): void {
  contextBridge.exposeInMainWorld(COMMENTS_BRIDGE_KEY, createUniworkCommentsApi())
}

export type { CommentsRevealPayload, UniworkCommentsApi }
