/// Preload half of the UniWork comments seam (see ./comments-ipc): exposes
/// window.uniworkComments, which forwards the editor's comment calls to the
/// shell main process over the COMMENTS_CHANNELS invoke channels, unwraps the
/// serializable CommentsReply back into the frame's DocsProtocolError, and
/// hands the main process's reveal pushes to the editor (pulling the one held
/// for this window on the first subscribe). Called once from every editor
/// preload, so all six apps expose the same surface.
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { DocsProtocolError, isProtocolErrorShape } from '../../../web/docs/protocol/types'
import { COMMENTS_BRIDGE_KEY, COMMENTS_CHANNELS, parseCommentsReveal } from './comments-ipc'
import type { CommentsRevealPayload, UniworkCommentsApi } from './comments-ipc'

/**
 * R1-1: a handler never throws a protocol error across IPC (Electron would keep
 * only its message); it answers { ok: true, value } or { ok: false, error } and
 * the renderer gets the frame's own DocsProtocolError back, fields intact.
 */
function unwrap<T>(reply: unknown): T {
  if (reply !== null && typeof reply === 'object' && (reply as { ok?: unknown }).ok === true) {
    return (reply as { value: T }).value
  }
  const error = (reply as { error?: unknown } | null | undefined)?.error
  throw new DocsProtocolError(
    isProtocolErrorShape(error)
      ? error
      : { code: 'internal', message: 'comments: malformed IPC reply' },
  )
}

async function call<T>(channel: string, input: unknown): Promise<T> {
  return unwrap<T>(await ipcRenderer.invoke(channel, input))
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
      // while the pull is in flight is pushed here; its answer names the same
      // reveal and must not deliver it twice.
      const pushed = new Set<string>()
      let pulling = true
      const key = (reveal: CommentsRevealPayload): string =>
        `${reveal.path}\u0000${reveal.commentId}`
      const listener = (_event: IpcRendererEvent, payload: unknown) => {
        const reveal = parseCommentsReveal(payload)
        if (!reveal) return
        if (pulling) pushed.add(key(reveal))
        handler(reveal)
      }
      ipcRenderer.on(COMMENTS_CHANNELS.reveal, listener)
      void ipcRenderer.invoke(COMMENTS_CHANNELS.revealPending).then(
        (pending: unknown) => {
          pulling = false
          const reveal = parseCommentsReveal(pending)
          if (reveal && !pushed.has(key(reveal))) handler(reveal)
        },
        () => {
          pulling = false
        },
      )
      return () => ipcRenderer.removeListener(COMMENTS_CHANNELS.reveal, listener)
    },
  }
}

export function installUniworkCommentsBridge(): void {
  contextBridge.exposeInMainWorld(COMMENTS_BRIDGE_KEY, createUniworkCommentsApi())
}

export type { CommentsRevealPayload, UniworkCommentsApi }
