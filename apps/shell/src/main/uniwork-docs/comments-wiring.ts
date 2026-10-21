import type { IpcMain, WebContents } from 'electron'
import {
  COMMENTS_CHANNELS,
  DISCUSSION_CHANNELS,
  parseDiscussionCreateInput,
  parseDiscussionListInput,
  parseDiscussionPanelInput,
  parseDiscussionRevealRequest,
  parseCommentsAnchorsInput,
  parseCommentsContextInput,
  parseCommentsCreateInput,
  parseCommentsIdInput,
  parseCommentsListInput,
  parseCommentsOpenVersionInput,
  parseCommentsUpdateInput,
  parseMentionsSearchInput,
} from '@genoffice/electron-utils/comments-ipc'
import type {
  CommentsAnchorsInput,
  CommentsContextResult,
  CommentsCreateInput,
  CommentsDocRef,
  CommentsIdInput,
  CommentsListInput,
  CommentsOpenVersionResult,
  CommentsReply,
  CommentsUpdateInput,
  CommentsRevealPayload,
  CommentsSavedPayload,
  DiscussionPanelInput,
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
  /**
   * G8-12: push a settled Save to the editor that shows `payload.path`. Not
   * held: an editor that mounts later reads the version through `context`.
   */
  sendSaved?(payload: CommentsSavedPayload): void
  /**
   * G8-11 (D2): the file paths open as tabs of the window whose SHELL
   * webContents is `sender`; null when `sender` is not a live shell
   * webContents. Every discussion channel is refused without it.
   */
  shellTabPaths?(sender: { id: number }): readonly string[] | null
  /**
   * G8-11 (D3): the shell webContents of the window that has `path` open as a
   * tab, for the discussion reveal push; null when no shell shows it.
   */
  shellTarget?(path: string): DiscussionPushTarget | null
  /** G8-11 (D1): narrow / restore the active editor view of the sender's window */
  setDiscussionPanel?(sender: { id: number }, panel: DiscussionPanelInput): void
  /** injectable for tests */
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  idempotencyKey?(): string
}

/** the slice of a shell webContents the discussion reveal push needs */
export interface DiscussionPushTarget extends Partial<Pick<WebContents, 'on'>> {
  id: number
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

/** a shell webContents' realm events (D2-2 reset), as the editor senders have */
type RealmSender = Pick<WebContents, 'id' | 'on'>

export interface UniworkCommentsHandle {
  /** reveal a comment in the editor showing `path` (the launch-ticket deep link) */
  reveal(path: string, commentId: string): void
  /** G8-12: a Save of `path` settled on server version `versionId` */
  saved(path: string, versionId: string): void
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

  // G8-12: the server context of the document the SENDER shows. Only the
  // editor showing `path` may read it (another window's editor, the shell or
  // an unknown sender is refused), an unbound path answers not_found, and
  // nothing goes to the network: every field comes from the binding.
  ipcMain.handle(
    COMMENTS_CHANNELS.context,
    async (event, payload: unknown): Promise<CommentsReply<CommentsContextResult>> => {
      const input: CommentsDocRef | null = parseCommentsContextInput(payload)
      if (!input) {
        return {
          ok: false,
          error: { code: 'malformed', message: 'comments: invalid request', retryable: false },
        }
      }
      try {
        if (!deps.shownPath || deps.shownPath(event.sender) !== input.path) {
          throw new DocsProtocolError({
            code: 'forbidden',
            message: 'comments: the sender does not show this document',
            retryable: false,
          })
        }
        return { ok: true, value: deps.service.commentContext(input.path) ?? unbound() }
      } catch (error) {
        return { ok: false, error: errorShape(error) }
      }
    },
  )

  // UNI-2033: "View in version N" of a lost comment. The shell opens the read-only copy of that
  // version and reveals the thread there. Only the editor showing `path` may ask, only for a
  // path that is a copy of the signed-in account, and only for a comment of that document
  // (one list read, no new endpoint); every refusal and failure is a plain `opened: false`
  ipcMain.handle(
    COMMENTS_CHANNELS.openVersion,
    async (event, payload: unknown): Promise<CommentsOpenVersionResult> => {
      const input = parseCommentsOpenVersionInput(payload)
      if (!input) return { opened: false }
      try {
        if (!deps.shownPath || deps.shownPath(event.sender) !== input.path) return { opened: false }
        const bound = resolveCommentBinding(deps.service, input.path)
        if (!bound) return { opened: false }
        const list = await api().list(bound, { path: input.path, kind: 'comment' })
        const known = list.comments.some((c) => c.id === input.commentId && c.kind === 'comment')
        if (!known) return { opened: false }
        await deps.service.openVersionView(bound.documentId, input.versionNo, input.commentId)
        return { opened: true }
      } catch {
        return { opened: false }
      }
    },
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

  // G8-11 (D2): the shell Discussion panel's bridge. Main answers it only for
  // the shell webContents of a window, only for a path that is an open tab of
  // THAT window and bound, and forces kind 'discussion' on list/create (the
  // parsers refuse an anchor or another kind). Id-based calls run against
  // that document's binding exactly like the editor ones; the server scopes
  // the comment id to it.
  const shellPaths = (sender: { id: number }): readonly string[] => {
    const paths = deps.shellTabPaths?.(sender) ?? null
    if (!paths) {
      throw new DocsProtocolError({
        code: 'forbidden',
        message: 'discussion: not a shell window',
        retryable: false,
      })
    }
    return paths
  }

  const discussionBinding = (sender: { id: number }, path: string): CommentBinding => {
    if (!shellPaths(sender).includes(path)) unbound()
    return binding(path)
  }

  // D2-2 for the shell: the armed discussion listeners belong to one realm of
  // the shell page. A reload, a navigation or a crash replaces it, so its
  // armed paths and the reveals held for that shell's tabs are dropped (the
  // new realm starts clean, like the editor side) and the editor view gets
  // its full width back (the panel is gone with it).
  const armed = new Map<number, Set<string>>()
  // D3: the latest launch reveal per path, held for the shell panel until the
  // shell pulls it for that path (delivered once)
  const shellHeld = new Map<string, string>()
  const watchedShells = new Set<number>()

  const watchShell = (sender: RealmSender): void => {
    if (watchedShells.has(sender.id) || typeof sender.on !== 'function') return
    watchedShells.add(sender.id)
    const id = sender.id
    const reset = (): void => {
      for (const path of armed.get(id) ?? []) shellHeld.delete(path)
      for (const path of deps.shellTabPaths?.({ id }) ?? []) shellHeld.delete(path)
      armed.delete(id)
      deps.setDiscussionPanel?.({ id }, { open: false, width: 0 })
    }
    sender.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) reset()
    })
    sender.on('did-navigate', reset)
    sender.on('render-process-gone', reset)
    sender.on('destroyed', () => {
      armed.delete(id)
      watchedShells.delete(id)
    })
  }

  // W11A-2: a hold lives only while a shell shows its path. A closed tab's hold
  // is swept on the next shell message or reveal, so the map is bounded by the
  // open tabs (plus the reveal being held right now).
  const sweepShellHeld = (keep?: string): void => {
    for (const path of [...shellHeld.keys()]) {
      if (path !== keep && !deps.shellTarget?.(path)) shellHeld.delete(path)
    }
  }

  const handleDiscussion = <I extends { path: string }, R>(
    channel: string,
    parse: (payload: unknown) => I | null,
    run: (binding: CommentBinding, input: I) => Promise<R>,
  ): void => {
    ipcMain.handle(channel, async (event, payload: unknown): Promise<CommentsReply<R>> => {
      const input = parse(payload)
      if (!input) {
        return {
          ok: false,
          error: { code: 'malformed', message: 'comments: invalid request', retryable: false },
        }
      }
      try {
        return { ok: true, value: await run(discussionBinding(event.sender, input.path), input) }
      } catch (error) {
        return { ok: false, error: errorShape(error) }
      }
    })
  }

  // the discussion channels exist only where a shell window can be told
  // apart (the shell build passes shellTabPaths); without it nothing is served
  if (deps.shellTabPaths) {
    handleDiscussion<CommentsListInput, unknown>(
      DISCUSSION_CHANNELS.list,
      parseDiscussionListInput,
      (bound, input) => api().list(bound, input),
    )
    handleDiscussion<CommentsCreateInput, unknown>(
      DISCUSSION_CHANNELS.create,
      parseDiscussionCreateInput,
      (bound, input) => api().create(bound, input),
    )
    handleDiscussion<CommentsUpdateInput, unknown>(
      DISCUSSION_CHANNELS.update,
      parseCommentsUpdateInput,
      (bound, input) => api().update(bound, input.commentId, input.body),
    )
    handleDiscussion<CommentsIdInput, unknown>(
      DISCUSSION_CHANNELS.remove,
      parseCommentsIdInput,
      (bound, input) => api().remove(bound, input.commentId),
    )
    handleDiscussion<CommentsIdInput, unknown>(
      DISCUSSION_CHANNELS.resolve,
      parseCommentsIdInput,
      (bound, input) => api().resolve(bound, input.commentId),
    )
    handleDiscussion<CommentsIdInput, unknown>(
      DISCUSSION_CHANNELS.reopen,
      parseCommentsIdInput,
      (bound, input) => api().reopen(bound, input.commentId),
    )
    handleDiscussion<CommentsIdInput, unknown>(
      DISCUSSION_CHANNELS.revisions,
      parseCommentsIdInput,
      (bound, input) => api().revisions(bound, input.commentId),
    )
    handleDiscussion<MentionsSearchInput, unknown>(
      DISCUSSION_CHANNELS.searchMentions,
      parseMentionsSearchInput,
      (bound, input) => api().searchMentions(bound, input),
    )

    ipcMain.handle(DISCUSSION_CHANNELS.revealPending, (event, payload: unknown) => {
      const request = parseDiscussionRevealRequest(payload)
      if (!request) return null
      const { path } = request
      // another window's, an unopened or an unbound path is neither returned,
      // armed nor cleared
      const paths = deps.shellTabPaths?.(event.sender) ?? null
      if (!paths || !paths.includes(path) || !resolveCommentBinding(deps.service, path)) return null
      watchShell(event.sender)
      sweepShellHeld()
      const set = armed.get(event.sender.id) ?? new Set<string>()
      set.add(path)
      armed.set(event.sender.id, set)
      const commentId = shellHeld.get(path)
      if (commentId === undefined) return null
      shellHeld.delete(path)
      return { path, commentId }
    })

    ipcMain.on(DISCUSSION_CHANNELS.revealRelease, (event, payload: unknown) => {
      const request = parseDiscussionRevealRequest(payload)
      if (!request) return
      // W11E-1: only a live shell that owns the path may let go of it - one of
      // its open tabs, or a path it armed (so the cleanup after a tab close
      // still works). An editor, an unknown sender or another shell window
      // must not cancel the owner's held reveal.
      const paths = deps.shellTabPaths?.(event.sender) ?? null
      const own = armed.get(event.sender.id)
      if (!paths || !(paths.includes(request.path) || own?.has(request.path))) return
      own?.delete(request.path)
      // W11A-2: the panel let go of this path; its hold goes with it
      shellHeld.delete(request.path)
    })

    ipcMain.on(DISCUSSION_CHANNELS.panel, (event, payload: unknown) => {
      const panel = parseDiscussionPanelInput(payload)
      if (!panel || !deps.shellTabPaths?.(event.sender)) return
      watchShell(event.sender)
      sweepShellHeld()
      deps.setDiscussionPanel?.(event.sender, panel)
    })
  }

  /** push to an armed shell listener for `path`, else hold until it pulls */
  const revealToShell = (path: string, commentId: string): void => {
    const target = deps.shellTarget?.(path) ?? null
    // a shell that never talked to us is watched from its first reveal, so a
    // reload before its first pull still starts a clean realm (W11A-1)
    if (target && !target.isDestroyed() && typeof target.on === 'function') {
      watchShell(target as RealmSender)
    }
    sweepShellHeld(path)
    if (target && !target.isDestroyed() && armed.get(target.id)?.has(path)) {
      target.send(DISCUSSION_CHANNELS.reveal, { path, commentId })
      shellHeld.delete(path)
      return
    }
    shellHeld.set(path, commentId)
  }

  return {
    reveal(path, commentId) {
      if (!resolveCommentBinding(deps.service, path)) return
      revealToShell(path, commentId)
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
    saved(path, versionId) {
      if (!resolveCommentBinding(deps.service, path)) return
      deps.sendSaved?.({ path, versionId })
    },
  }
}
