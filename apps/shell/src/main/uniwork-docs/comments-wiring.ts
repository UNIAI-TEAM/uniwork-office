import type { IpcMain, WebContents } from 'electron'
import {
  COMMENTS_CHANNELS,
  parseCommentsAnchorsInput,
  parseCommentsCreateInput,
  parseCommentsIdInput,
  parseCommentsListInput,
  parseCommentsUpdateInput,
  parseMentionsSearchInput,
} from '@genoffice/electron-utils/comments-ipc'
import type {
  CommentsAnchorsInput,
  CommentsCreateInput,
  CommentsIdInput,
  CommentsListInput,
  CommentsReply,
  CommentsUpdateInput,
  CommentsRevealPayload,
  MentionsSearchInput,
} from '@genoffice/electron-utils/comments-ipc'
import { DocsProtocolError, type ProtocolErrorShape } from '../../../../../web/docs/protocol/types'
import type { PushOutcome } from './launch'
import type { UniworkDocsService } from './service'
import {
  createUniworkCommentsClient,
  type CommentBinding,
  type UniworkCommentsClient,
} from './comments'

/**
 * G8-08 (UNI-1403): binds the main-process comments client to IPC. One handler
 * per request kind of contract §10 (plus `comments.list` with `since_token`).
 * Every request names the working-copy `path` the editor shows; the wiring
 * resolves the binding from the documents service, so an UNBOUND document (a
 * plain local file, another account's copy, a newer-store lock) makes NO request
 * at all: the handler rejects with the §9 `not_found` shape and the client is
 * never reached. The server is the only permission gate; the access level is
 * carried along for the editor's display hint only.
 */

export interface CommentsWiringDeps {
  service: UniworkDocsService
  /** the current deployment origin, or null when signed out */
  profile(): { apiOrigin: string } | null
  /** the same single-flight authorized request the documents client uses */
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  isSignedIn(): boolean
  /**
   * Push a reveal to the editor showing `path`. Returns 'delivered' when it was
   * handed straight to a loaded editor, 'deferred' when it waits for
   * did-finish-load (the renderer may not listen yet) and 'none' when nothing
   * shows the path. `stillWanted` is consulted for a deferred push: the pull may
   * have delivered the held reveal first (D1-4).
   */
  sendReveal(payload: CommentsRevealPayload, stillWanted: () => boolean): PushOutcome
  /**
   * R1-2: the path the invoking editor window shows; its held reveal is pulled
   * for exactly that path. undefined/null when nothing shows one.
   */
  shownPath?(sender: { id: number }): string | null
  /** injectable for tests */
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  idempotencyKey?(): string
}

export interface UniworkCommentsHandle {
  /** reveal a comment in the editor showing `path` (the launch-ticket deep link) */
  reveal(path: string, commentId: string): void
}

/** the binding a comments request may run against, or null when the path is not ours */
export function resolveCommentBinding(
  service: UniworkDocsService,
  path: string,
): CommentBinding | null {
  const source = service.recentSource(path)
  if (!source || source === 'hidden') return null
  return { documentId: source.documentId }
}

/** the §9 `not_found` shape for an unbound document: no request is made */
function unbound(): never {
  throw new DocsProtocolError({
    code: 'not_found',
    message: 'comments: document is not bound to UniWork',
    retryable: false,
  })
}

/** the serializable §9 shape of anything a handler may throw (R1-1) */
function errorShape(error: unknown): ProtocolErrorShape {
  if (error instanceof DocsProtocolError) return error.toShape()
  return {
    code: 'internal',
    message: error instanceof Error ? error.message : 'comments: internal error',
  }
}

export function createUniworkComments(
  ipcMain: IpcMain,
  deps: CommentsWiringDeps,
): UniworkCommentsHandle {
  let client: UniworkCommentsClient | null = null
  let origin: string | null = null

  const api = (): UniworkCommentsClient => {
    const profile = deps.profile()
    if (!profile) unbound()
    if (!client || origin !== profile.apiOrigin) {
      client = createUniworkCommentsClient({
        apiOrigin: profile.apiOrigin,
        authorized: (call) => deps.authorized(call),
        isSignedIn: () => deps.isSignedIn(),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.idempotencyKey ? { idempotencyKey: deps.idempotencyKey } : {}),
      })
      origin = profile.apiOrigin
    }
    return client
  }

  const binding = (path: string): CommentBinding => {
    const found = resolveCommentBinding(deps.service, path)
    return found ?? unbound()
  }

  const handle = <I extends { path: string }, R>(
    channel: string,
    parse: (payload: unknown) => I | null,
    run: (input: I) => Promise<R>,
  ): void => {
    ipcMain.handle(channel, async (_event, payload: unknown): Promise<CommentsReply<R>> => {
      // R1-1: a protocol error is answered as plain data - thrown across
      // Electron it would keep only its message - and the preload rehydrates it
      const input = parse(payload)
      if (!input) {
        return {
          ok: false,
          error: { code: 'malformed', message: 'comments: invalid request', retryable: false },
        }
      }
      try {
        return { ok: true, value: await run(input) }
      } catch (error) {
        return { ok: false, error: errorShape(error) }
      }
    })
  }

  handle<CommentsListInput, unknown>(COMMENTS_CHANNELS.list, parseCommentsListInput, (input) =>
    api().list(binding(input.path), input),
  )
  handle<CommentsCreateInput, unknown>(
    COMMENTS_CHANNELS.create,
    parseCommentsCreateInput,
    (input) => api().create(binding(input.path), input),
  )
  handle<CommentsUpdateInput, unknown>(
    COMMENTS_CHANNELS.update,
    parseCommentsUpdateInput,
    (input) => api().update(binding(input.path), input.commentId, input.body),
  )
  handle<CommentsIdInput, unknown>(COMMENTS_CHANNELS.remove, parseCommentsIdInput, (input) =>
    api().remove(binding(input.path), input.commentId),
  )
  handle<CommentsIdInput, unknown>(COMMENTS_CHANNELS.resolve, parseCommentsIdInput, (input) =>
    api().resolve(binding(input.path), input.commentId),
  )
  handle<CommentsIdInput, unknown>(COMMENTS_CHANNELS.reopen, parseCommentsIdInput, (input) =>
    api().reopen(binding(input.path), input.commentId),
  )
  handle<CommentsIdInput, unknown>(COMMENTS_CHANNELS.revisions, parseCommentsIdInput, (input) =>
    api().revisions(binding(input.path), input.commentId),
  )
  handle<CommentsAnchorsInput, unknown>(
    COMMENTS_CHANNELS.anchors,
    parseCommentsAnchorsInput,
    (input) => api().anchors(binding(input.path), input),
  )
  handle<MentionsSearchInput, unknown>(
    COMMENTS_CHANNELS.searchMentions,
    parseMentionsSearchInput,
    (input) => api().searchMentions(binding(input.path), input),
  )

  // R1-2: the latest reveal per path, held until that editor pulls it. A push
  // reaches a renderer that already subscribed; a renderer that subscribed
  // afterwards (cold start) would never see it, so the hold survives the push.
  const heldReveals = new Map<string, string>()
  // D1-1: paths whose editor has pulled the held reveal; its listener is armed
  // from then on (main cannot see the listener itself)
  const subscribed = new Set<string>()
  // D2-2: `subscribed` is keyed by path, but the subscription belongs to one
  // realm of that path's editor. A reload, a navigation, a crashed process or
  // the closed editor replaces the realm without the wiring noticing; the stale
  // flag would then report a push inside that window delivered - the push is
  // sent into a page whose listener is not armed yet, the hold is cleared, and
  // the new realm's pull reads null. Watching the sender's webContents drops
  // the path from `subscribed` the moment its document is replaced, so a push
  // in the window stays held and the new realm's pull gets it exactly once.
  const watchedRealm = new Map<number, { path: string }>()

  const watchRealm = (sender: WebContents, path: string): void => {
    const watched = watchedRealm.get(sender.id)
    if (watched) {
      watched.path = path
      return
    }
    const entry = { path }
    const reset = (): void => {
      subscribed.delete(entry.path)
    }
    sender.on('did-start-navigation', (details) => {
      // an in-page navigation keeps the document (and its armed listener)
      if (details.isMainFrame && !details.isSameDocument) reset()
    })
    sender.on('did-navigate', reset)
    sender.on('render-process-gone', reset)
    sender.on('destroyed', () => {
      reset()
      watchedRealm.delete(sender.id)
    })
    watchedRealm.set(sender.id, entry)
  }

  ipcMain.handle(COMMENTS_CHANNELS.revealPending, (event) => {
    // scoped to the sender's own path: another editor's held reveal is neither
    // returned nor cleared
    const path = deps.shownPath?.(event.sender) ?? null
    if (!path) return null
    subscribed.add(path)
    watchRealm(event.sender, path)
    const commentId = heldReveals.get(path)
    if (commentId === undefined) return null
    heldReveals.delete(path)
    return { path, commentId }
  })

  return {
    reveal(path, commentId) {
      if (!resolveCommentBinding(deps.service, path)) return
      const outcome = deps.sendReveal({ path, commentId }, () => {
        // D1-4: the deferred push is dropped once a pull delivered the reveal
        // D1-1: if the editor is subscribed by then, the push lands in its
        // listener, which ends the hold
        const held = heldReveals.get(path) === commentId
        if (held && subscribed.has(path)) heldReveals.delete(path)
        return held
      })
      // D1-1: a push handed straight to a subscribed editor lands in its
      // listener, so the hold (this reveal, or a stale one for the path) is
      // over - a later resubscribe must not replay it. Anything else (a deferred
      // push, no editor, an editor that has not pulled yet) stays held for the
      // first pull.
      if (outcome === 'delivered' && subscribed.has(path)) heldReveals.delete(path)
      else heldReveals.set(path, commentId)
    },
  }
}
