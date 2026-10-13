import type { IpcMain } from 'electron'
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
  CommentsUpdateInput,
  CommentsRevealPayload,
  MentionsSearchInput,
} from '@genoffice/electron-utils/comments-ipc'
import type { UniworkDocAccess } from '../../shared/home-api'
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
  /** push a reveal to the editor showing `path`; no-op when nothing shows it */
  sendReveal(payload: CommentsRevealPayload): void
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
  return {
    documentId: source.documentId,
    workspaceId: source.workspaceId,
    orgId: '',
    access: source.access as UniworkDocAccess,
  }
}

/** the §9 `not_found` shape for an unbound document: no request is made */
function unbound(): never {
  const error = new Error('comments: document is not bound to UniWork')
  Object.assign(error, { name: 'DocsProtocolError', code: 'not_found', retryable: false })
  throw error
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
    ipcMain.handle(channel, async (_event, payload: unknown) => {
      const input = parse(payload)
      if (!input) {
        const error = new Error('comments: invalid request')
        Object.assign(error, { name: 'DocsProtocolError', code: 'malformed', retryable: false })
        throw error
      }
      return run(input)
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

  return {
    reveal(path, commentId) {
      if (!resolveCommentBinding(deps.service, path)) return
      deps.sendReveal({ path, commentId })
    },
  }
}
