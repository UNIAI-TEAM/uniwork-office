import type { IpcMain } from 'electron'
import {
  ASKUNI_DOC_CHANNELS,
  type AskUniDocBound,
  type AskUniDocFlags,
  type AskUniFailure,
  type AskUniMessagesResult,
  type AskUniOkResult,
  type AskUniStreamEvent,
  type AskUniStreamRequest,
  type AskUniStreamStart,
} from '../../shared/askuni-api'
import type { AskUniRestService } from './rest-service'
import type { AskUniStreamClient } from './stream-client'
import {
  createAskUniStreamService,
  type AskUniFlagsReader,
  type AskUniStreamSender,
} from './stream-service'

/**
 * Ask UNI in an editor panel (`uniwork:askuni-doc:*`). The editor never names
 * a workspace or a document: main reads the path its own webContents shows,
 * that path's binding gives the workspace and the document focus, and any
 * other field the renderer sends is dropped. A local file is not_bound,
 * another account's copy forbidden. The stream runs on S1's stream service
 * (events to that editor only, one stream per editor, own cancel); it ends
 * when the editor is destroyed or navigates (silently) or its path or the
 * account changes (as cancelled). History and feedback answer only for the
 * conversations this editor saw in its own `run` event since then.
 */

/** the part of an editor webContents the service uses */
export interface AskUniDocSender {
  readonly id: number
  isDestroyed(): boolean
  send(channel: string, ev: AskUniStreamEvent): void
  once(event: 'destroyed', listener: () => void): unknown
  on(event: 'did-navigate', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'did-navigate', listener: () => void): unknown
}

/** a bound path's workspace + document, 'hidden' for another account's copy, null for a local file */
export type AskUniDocBinding = { workspaceId: string; documentId: string } | 'hidden' | null

export interface AskUniDocServiceDeps {
  isSignedIn(): boolean
  /** account + org; a change cancels the streams and forgets the conversations */
  scopeKey(): string | null
  /** the path the editor webContents shows, null when none */
  shownPath(sender: { id: number }): string | null
  binding(path: string): AskUniDocBinding
  client: AskUniStreamClient
  /** S2's validating REST service; reached only for an own conversation */
  rest: Pick<AskUniRestService, 'messages' | 'feedbackSet' | 'feedbackClear'>
  flags: AskUniFlagsReader
  newRequestId?(): string
  scopeCheckMs?: number
}

export interface AskUniDocService {
  start(sender: AskUniDocSender, input: unknown): Promise<AskUniStreamStart>
  cancel(sender: AskUniDocSender, input: unknown): AskUniOkResult
  messages(sender: AskUniDocSender, input: unknown): Promise<AskUniMessagesResult>
  feedbackSet(sender: AskUniDocSender, input: unknown): Promise<AskUniOkResult>
  feedbackClear(sender: AskUniDocSender, input: unknown): Promise<AskUniOkResult>
  flags(sender: AskUniDocSender): Promise<AskUniDocFlags>
  /** running streams (tests) */
  active(): number
}

/** what main knows about one editor since its path last changed */
interface Track {
  sender: AskUniDocSender
  path: string
  scope: string | null
  /** conversation ids seen in this editor's own `run` events */
  conversations: Set<string>
  /** the stream service's 'destroyed' listeners of this editor's runs */
  aborts: Set<() => void>
  /** destroyed or navigated: nothing more is sent */
  gone: boolean
  /** path or account changed: a running request still gets its cancelled terminal */
  stale: boolean
  forget(): void
}

const ERROR: AskUniFailure = { ok: false, error: 'error' }
const FORBIDDEN: AskUniFailure = { ok: false, error: 'forbidden' }

const record = (input: unknown): Record<string, unknown> | null =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null

export function createAskUniDocService(deps: AskUniDocServiceDeps): AskUniDocService {
  const tracks = new Map<number, Track>()
  const stream = createAskUniStreamService({
    isSignedIn: deps.isSignedIn,
    scopeKey: deps.scopeKey,
    // the workspace comes from the account's own binding, never from the renderer
    checkWorkspace: async () => null,
    client: deps.client,
    ...(deps.newRequestId ? { newRequestId: deps.newRequestId } : {}),
    ...(deps.scopeCheckMs !== undefined ? { scopeCheckMs: deps.scopeCheckMs } : {}),
  })

  const retire = (track: Track, how: 'gone' | 'stale') => {
    if (tracks.get(track.sender.id) === track) tracks.delete(track.sender.id)
    track.forget()
    track.conversations.clear()
    track[how] = true
    for (const abort of [...track.aborts]) abort()
    track.aborts.clear()
  }

  /** this editor's track while its path and account are unchanged, else null */
  const currentTrack = (sender: AskUniDocSender, path: string): Track | null => {
    const track = tracks.get(sender.id)
    if (!track) return null
    if (track.path === path && track.scope === deps.scopeKey()) return track
    retire(track, 'stale')
    return null
  }

  const trackOf = (sender: AskUniDocSender, path: string): Track => {
    const existing = currentTrack(sender, path)
    if (existing) return existing
    const onGone = () => retire(track, 'gone')
    const track: Track = {
      sender,
      path,
      scope: deps.scopeKey(),
      conversations: new Set(),
      aborts: new Set(),
      gone: false,
      stale: false,
      forget: () => {
        sender.removeListener('destroyed', onGone)
        sender.removeListener('did-navigate', onGone)
      },
    }
    sender.once('destroyed', onGone)
    sender.on('did-navigate', onGone)
    tracks.set(sender.id, track)
    return track
  }

  /** the stream service's sender for one track: the doc event channel, ownership, path watch */
  const viewOf = (track: Track): AskUniStreamSender => {
    const { sender } = track
    const view: AskUniStreamSender = {
      id: sender.id,
      isDestroyed: () => track.gone || sender.isDestroyed(),
      send: (_channel, ev) => {
        if (track.gone) return
        if (!track.stale && deps.shownPath(sender) !== track.path) {
          // the cancelled terminal comes back through here as stale
          retire(track, 'stale')
          return
        }
        if (track.stale && ev.type !== 'error' && ev.type !== 'done') return
        if (!track.stale && ev.type === 'run') track.conversations.add(ev.conversationId)
        sender.send(ASKUNI_DOC_CHANNELS.streamEvent, ev)
      },
      once: (_event, listener) => void track.aborts.add(listener),
      // the editor's own did-navigate watch already retires the track
      on: () => undefined,
      removeListener: (event, listener) => {
        if (event === 'destroyed') track.aborts.delete(listener)
      },
    }
    return view
  }

  type Resolved = { path: string; workspaceId: string; documentId: string }
  /** signed in, then the sender's path and its binding */
  const resolve = (sender: AskUniDocSender): Resolved | AskUniFailure => {
    if (!deps.isSignedIn()) return { ok: false, error: 'signed_out' }
    const path = deps.shownPath(sender)
    const binding = path ? deps.binding(path) : null
    if (!path || binding === null) return { ok: false, error: 'not_bound' }
    if (binding === 'hidden') return FORBIDDEN
    return { path, workspaceId: binding.workspaceId, documentId: binding.documentId }
  }

  /** the conversation id of `input` when it is one of this editor's, else the refusal */
  const ownConversation = (
    sender: AskUniDocSender,
    input: unknown,
  ): { conversationId: string; r: Record<string, unknown> } | AskUniFailure => {
    const at = resolve(sender)
    if ('ok' in at) return at
    const r = record(input)
    const cid = r?.conversationId
    const track = currentTrack(sender, at.path)
    if (!r || typeof cid !== 'string' || !track?.conversations.has(cid)) return FORBIDDEN
    return { conversationId: cid, r }
  }

  return {
    async start(sender, input) {
      const r = record(input)
      if (!r) return ERROR
      const at = resolve(sender)
      if ('ok' in at) return at
      const track = trackOf(sender, at.path)
      if (r.conversationId !== undefined) {
        if (typeof r.conversationId !== 'string' || !track.conversations.has(r.conversationId)) {
          return FORBIDDEN
        }
      }
      // only the editor contract fields; workspace and focus are main's
      const req: Partial<Record<keyof AskUniStreamRequest, unknown>> = {
        workspaceId: at.workspaceId,
        question: r.question,
        locale: r.locale ?? 'en',
        focus: { kind: 'document', id: at.documentId },
        ...(r.model !== undefined ? { model: r.model } : {}),
        ...(r.effort !== undefined ? { effort: r.effort } : {}),
        ...(r.conversationId !== undefined ? { conversationId: r.conversationId } : {}),
      }
      return stream.start(viewOf(track), req)
    },

    cancel(sender, input) {
      // the stream service matches the request's sender by id only
      return stream.cancel({ id: sender.id } as AskUniStreamSender, input)
    },

    async messages(sender, input) {
      const own = ownConversation(sender, input)
      if ('ok' in own) return own
      return deps.rest.messages({ conversationId: own.conversationId })
    },

    async feedbackSet(sender, input) {
      const own = ownConversation(sender, input)
      if ('ok' in own) return own
      const { r } = own
      return deps.rest.feedbackSet({
        conversationId: own.conversationId,
        messageId: r.messageId,
        rating: r.rating,
        ...(r.reason !== undefined ? { reason: r.reason } : {}),
        ...(r.note !== undefined ? { note: r.note } : {}),
      })
    },

    async feedbackClear(sender, input) {
      const own = ownConversation(sender, input)
      if ('ok' in own) return own
      return deps.rest.feedbackClear({
        conversationId: own.conversationId,
        messageId: own.r.messageId,
      })
    },

    async flags(sender) {
      if (!deps.isSignedIn()) return { streamEnabled: false, bound: 'signed_out' }
      const path = deps.shownPath(sender)
      const binding = path ? deps.binding(path) : null
      const bound: AskUniDocBound =
        binding === null ? 'local' : binding === 'hidden' ? 'hidden' : 'document'
      let streamEnabled = false
      try {
        streamEnabled = (await deps.flags.flags()).streamEnabled === true
      } catch {
        // off
      }
      return { streamEnabled, bound }
    },

    active: () => stream.active(),
  }
}

/**
 * Registered on the guarded ipc object (UNI-2073, policy `editor`): only a trusted editor view's
 * main frame on an editor origin gets here. What the guard does not do stays in the service: the
 * document comes from the sender's own bound path, conversations and feedback answer only for ids
 * this sender saw, events go to `event.sender` only.
 */
export function registerAskUniDocIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  deps: { doc: AskUniDocService },
): void {
  const { doc } = deps
  const C = ASKUNI_DOC_CHANNELS
  ipcMain.handle(C.stream, (event, input: unknown) => doc.start(event.sender, input))
  ipcMain.handle(C.streamCancel, (event, input: unknown) => doc.cancel(event.sender, input))
  ipcMain.handle(C.messages, (event, input: unknown) => doc.messages(event.sender, input))
  ipcMain.handle(C.feedbackSet, (event, input: unknown) => doc.feedbackSet(event.sender, input))
  ipcMain.handle(C.feedbackClear, (event, input: unknown) => doc.feedbackClear(event.sender, input))
  ipcMain.handle(C.flags, (event) => doc.flags(event.sender))
}
