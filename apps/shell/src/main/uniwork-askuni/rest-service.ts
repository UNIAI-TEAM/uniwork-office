import type { IpcMain } from 'electron'
import {
  ASKUNI_FOCUS_KINDS,
  ASKUNI_MAX_FEEDBACK_NOTE,
  ASKUNI_MAX_TITLE,
  ASKUNI_MENTION_KINDS,
  ASKUNI_V2_CHANNELS,
  type AskUniCapabilitiesResult,
  type AskUniConversationsResult,
  type AskUniErrorCode,
  type AskUniFailure,
  type AskUniFeedbackReason,
  type AskUniFeedbackRequest,
  type AskUniLookupResult,
  type AskUniMessagesResult,
  type AskUniObjectKind,
  type AskUniOkResult,
} from '../../shared/askuni-api'
import type { AskUniLookupClient } from './lookup-client'
import type { AskUniRestClient } from './rest-client'

/**
 * The Ask UNI v2 REST service behind `uniwork:askuni:{capabilities,
 * conversations, messages, rename, delete, feedback-set, feedback-clear,
 * lookup}`: validates what the renderer sends (a refused input never reaches
 * the network), checks the workspace like P1 for the workspace routes, and
 * answers `{ok:true,...} | {ok:false, error}`, never a throw. The server
 * still decides who owns a conversation (someone else's answers 404).
 */

export interface AskUniRestServiceDeps {
  isSignedIn(): boolean
  /** null when the workspace is one of the account's (P1 cached list), else the code */
  checkWorkspace(workspaceId: string): Promise<AskUniErrorCode | null>
  rest: AskUniRestClient
  lookup: AskUniLookupClient
}

export interface AskUniRestService {
  capabilities(input: unknown): Promise<AskUniCapabilitiesResult>
  conversations(input: unknown): Promise<AskUniConversationsResult>
  messages(input: unknown): Promise<AskUniMessagesResult>
  rename(input: unknown): Promise<AskUniOkResult>
  remove(input: unknown): Promise<AskUniOkResult>
  feedbackSet(input: unknown): Promise<AskUniOkResult>
  feedbackClear(input: unknown): Promise<AskUniOkResult>
  lookup(input: unknown): Promise<AskUniLookupResult>
}

const ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_QUERY = 200
const REASONS: ReadonlySet<string> = new Set<AskUniFeedbackReason>([
  'wrong_facts',
  'missing_sources',
  'not_helpful',
  'other',
])
/** the kinds a picker can list (email threads have no list in the app) */
const LOOKUP_KINDS: ReadonlySet<string> = new Set<AskUniObjectKind>(
  [...ASKUNI_FOCUS_KINDS, ...ASKUNI_MENTION_KINDS].filter((k) => k !== 'email_thread'),
)

const ERROR: AskUniFailure = { ok: false, error: 'error' }
const record = (input: unknown): Record<string, unknown> | null =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null
const idOf = (value: unknown): string | null =>
  typeof value === 'string' && ID.test(value) ? value : null

export function createAskUniRestService(deps: AskUniRestServiceDeps): AskUniRestService {
  /** runs `call` once signed in; a throw is an error result */
  const guarded = async <T>(call: () => Promise<T | AskUniFailure>): Promise<T | AskUniFailure> => {
    if (!deps.isSignedIn()) return { ok: false, error: 'signed_out' }
    try {
      return await call()
    } catch {
      return ERROR
    }
  }

  /** the workspace routes: a valid id that is one of the account's, then `call` */
  const inWorkspace = async <T>(
    input: unknown,
    call: (workspaceId: string, r: Record<string, unknown>) => Promise<T | AskUniFailure> | null,
  ): Promise<T | AskUniFailure> => {
    const r = record(input)
    const workspaceId = idOf(r?.workspaceId)
    if (!r || !workspaceId) return ERROR
    return guarded(async () => {
      const refused = await deps.checkWorkspace(workspaceId)
      if (refused) return { ok: false, error: refused }
      return (await call(workspaceId, r)) ?? ERROR
    })
  }

  const conversationOf = (input: unknown): string | null => idOf(record(input)?.conversationId)

  return {
    capabilities: (input) => inWorkspace(input, (ws) => deps.rest.capabilities(ws)),
    conversations: (input) => inWorkspace(input, (ws) => deps.rest.conversations(ws)),

    async messages(input) {
      const cid = conversationOf(input)
      return cid ? guarded(() => deps.rest.messages(cid)) : ERROR
    },

    async rename(input) {
      const cid = conversationOf(input)
      const raw = record(input)?.title
      const title = typeof raw === 'string' ? raw.trim() : ''
      if (!cid || title.length < 1 || title.length > ASKUNI_MAX_TITLE) return ERROR
      return guarded(() => deps.rest.rename(cid, title))
    },

    async remove(input) {
      const cid = conversationOf(input)
      return cid ? guarded(() => deps.rest.remove(cid)) : ERROR
    },

    async feedbackSet(input) {
      const r = record(input)
      const cid = idOf(r?.conversationId)
      const mid = idOf(r?.messageId)
      if (!r || !cid || !mid || (r.rating !== 'up' && r.rating !== 'down')) return ERROR
      if (r.reason !== undefined && (typeof r.reason !== 'string' || !REASONS.has(r.reason))) {
        return ERROR
      }
      if (
        r.note !== undefined &&
        (typeof r.note !== 'string' || r.note.length > ASKUNI_MAX_FEEDBACK_NOTE)
      ) {
        return ERROR
      }
      const req: AskUniFeedbackRequest = {
        conversationId: cid,
        messageId: mid,
        rating: r.rating,
        ...(r.reason !== undefined ? { reason: r.reason as AskUniFeedbackReason } : {}),
        ...(r.note !== undefined ? { note: r.note as string } : {}),
      }
      return guarded(() => deps.rest.feedbackSet(req))
    },

    async feedbackClear(input) {
      const r = record(input)
      const cid = idOf(r?.conversationId)
      const mid = idOf(r?.messageId)
      return cid && mid ? guarded(() => deps.rest.feedbackClear(cid, mid)) : ERROR
    },

    lookup: (input) =>
      inWorkspace(input, (workspaceId, r) => {
        if (typeof r.kind !== 'string' || !LOOKUP_KINDS.has(r.kind)) return null
        if (typeof r.query !== 'string') return null
        return deps.lookup.lookup({
          workspaceId,
          kind: r.kind as AskUniObjectKind,
          query: r.query.trim().slice(0, MAX_QUERY),
        })
      }),
  }
}

/** Registered on the guarded ipc object (UNI-2073, policy `shell`): the guard refuses every other sender first. */
export function registerAskUniRestIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  deps: { rest: AskUniRestService },
): void {
  const { rest } = deps
  ipcMain.handle(ASKUNI_V2_CHANNELS.capabilities, (_event, input: unknown) =>
    rest.capabilities(input),
  )
  ipcMain.handle(ASKUNI_V2_CHANNELS.conversations, (_event, input: unknown) =>
    rest.conversations(input),
  )
  ipcMain.handle(ASKUNI_V2_CHANNELS.messages, (_event, input: unknown) => rest.messages(input))
  ipcMain.handle(ASKUNI_V2_CHANNELS.rename, (_event, input: unknown) => rest.rename(input))
  ipcMain.handle(ASKUNI_V2_CHANNELS.delete, (_event, input: unknown) => rest.remove(input))
  ipcMain.handle(ASKUNI_V2_CHANNELS.feedbackSet, (_event, input: unknown) =>
    rest.feedbackSet(input),
  )
  ipcMain.handle(ASKUNI_V2_CHANNELS.feedbackClear, (_event, input: unknown) =>
    rest.feedbackClear(input),
  )
  ipcMain.handle(ASKUNI_V2_CHANNELS.lookup, (_event, input: unknown) => rest.lookup(input))
}
