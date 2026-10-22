import {
  ASKUNI_MAX_RETRY_AFTER_SEC,
  ASKUNI_MAX_TITLE,
  type AskUniCapabilitiesResult,
  type AskUniConversation,
  type AskUniConversationsResult,
  type AskUniFailure,
  type AskUniFeedbackRequest,
  type AskUniMessage,
  type AskUniMessagesResult,
  type AskUniModelOption,
  type AskUniOkResult,
} from '../../shared/askuni-api'
import {
  createUniworkSend,
  METADATA_TIMEOUT_MS,
  type UniworkCall,
  type UniworkDocsClientOptions,
} from '../uniwork-docs/client'
import { UniworkDocError } from '../uniwork-docs/errors'
import { askUniV2CodeOfError, parseMessage } from './stream-client'

/**
 * Ask UNI v2 conversation REST in the shell main process (capabilities, my
 * conversations, their messages, rename, delete, answer feedback) through
 * the same hardened request as the stream (device bearer added in main only,
 * one refresh on a 401, no redirects) and the same error map. Every answer is
 * bounded here; nothing throws: each call is a `{ok:true,...} | {ok:false, error}`.
 */

export interface AskUniRestClient {
  capabilities(workspaceId: string): Promise<AskUniCapabilitiesResult>
  conversations(workspaceId: string): Promise<AskUniConversationsResult>
  messages(conversationId: string): Promise<AskUniMessagesResult>
  rename(conversationId: string, title: string): Promise<AskUniOkResult>
  remove(conversationId: string): Promise<AskUniOkResult>
  feedbackSet(req: AskUniFeedbackRequest): Promise<AskUniOkResult>
  feedbackClear(conversationId: string, messageId: string): Promise<AskUniOkResult>
}

const ID = /^[A-Za-z0-9_-]{1,128}$/
const MODEL_KEYS: ReadonlySet<string> = new Set(['haiku', 'sonnet', 'opus'])
/** the server lists 20 conversations; a longer list is cut, not trusted */
const MAX_CONVERSATIONS = 100
const MAX_MESSAGES = 500

/** a failed call -> the v2 failure, a throttle carrying its wait (clamped to an hour) */
export function askUniFailure(error: unknown): AskUniFailure {
  const code = askUniV2CodeOfError(error)
  if (
    code === 'rate_limited' &&
    error instanceof UniworkDocError &&
    error.retryAfterMs !== undefined
  ) {
    return {
      ok: false,
      error: code,
      retryAfterSeconds: Math.min(ASKUNI_MAX_RETRY_AFTER_SEC, Math.ceil(error.retryAfterMs / 1000)),
    }
  }
  return { ok: false, error: code }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const score = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(10, Math.floor(v)) : null
const bad = (): never => {
  throw new UniworkDocError('malformed_response')
}

function parseCapabilities(raw: unknown): AskUniCapabilitiesResult {
  if (!isObj(raw) || typeof raw.enabled !== 'boolean') return bad()
  if (raw.models !== undefined && raw.models !== null && !Array.isArray(raw.models)) return bad()
  const models = (Array.isArray(raw.models) ? raw.models : []).flatMap((m): AskUniModelOption[] => {
    if (!isObj(m) || typeof m.key !== 'string' || !MODEL_KEYS.has(m.key)) return []
    const speed = score(m.speed)
    const intelligence = score(m.intelligence)
    const cost = score(m.cost)
    if (speed === null || intelligence === null || cost === null) return []
    if (typeof m.enabled !== 'boolean') return []
    return [
      { key: m.key as AskUniModelOption['key'], speed, intelligence, cost, enabled: m.enabled },
    ]
  })
  const auto = typeof raw.auto_model === 'string' && MODEL_KEYS.has(raw.auto_model)
  return {
    ok: true,
    enabled: raw.enabled,
    models,
    autoModel: auto ? (raw.auto_model as string) : '',
  }
}

function parseConversations(raw: unknown): AskUniConversationsResult {
  if (!isObj(raw) || !Array.isArray(raw.conversations)) return bad()
  const conversations = (raw.conversations as unknown[])
    .flatMap((c): AskUniConversation[] => {
      if (!isObj(c) || typeof c.id !== 'string' || !ID.test(c.id)) return []
      if (typeof c.title !== 'string') return []
      return [
        {
          id: c.id,
          title: c.title.slice(0, ASKUNI_MAX_TITLE),
          createdAt: typeof c.created_at === 'string' ? c.created_at : '',
          updatedAt: typeof c.updated_at === 'string' ? c.updated_at : '',
        },
      ]
    })
    .slice(0, MAX_CONVERSATIONS)
  return { ok: true, conversations }
}

function parseMessages(raw: unknown): AskUniMessagesResult {
  if (!isObj(raw) || !Array.isArray(raw.messages)) return bad()
  const messages = (raw.messages as unknown[])
    .map(parseMessage)
    .filter((m): m is AskUniMessage => m !== null)
    .slice(0, MAX_MESSAGES)
  return { ok: true, messages }
}

const OK: AskUniOkResult = { ok: true }

export function createAskUniRestClient(options: UniworkDocsClientOptions): AskUniRestClient {
  const send = createUniworkSend(options)
  const timeoutMs = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const enc = encodeURIComponent

  /** one call; any failure is the mapped failure, never a throw */
  async function call<T>(req: Omit<UniworkCall<T>, 'timeoutMs'>): Promise<T | AskUniFailure> {
    try {
      return await send<T>({ ...req, timeoutMs })
    } catch (error) {
      return askUniFailure(error)
    }
  }
  const json = async (response: Response): Promise<unknown> => response.json()
  /** a write answers 200 with a body or 204 without one; either is done */
  const done = async (): Promise<AskUniOkResult> => OK

  return {
    capabilities: (ws) =>
      call({
        method: 'GET',
        route: `/workspaces/${enc(ws)}/ai/capabilities`,
        read: async (r) => parseCapabilities(await json(r)),
      }),
    conversations: (ws) =>
      call({
        method: 'GET',
        route: `/workspaces/${enc(ws)}/ai/conversations`,
        read: async (r) => parseConversations(await json(r)),
      }),
    messages: (cid) =>
      call({
        method: 'GET',
        route: `/ai/conversations/${enc(cid)}/messages`,
        read: async (r) => parseMessages(await json(r)),
      }),
    rename: (cid, title) =>
      call({
        method: 'PATCH',
        route: `/ai/conversations/${enc(cid)}`,
        json: { title },
        read: done,
      }),
    remove: (cid) => call({ method: 'DELETE', route: `/ai/conversations/${enc(cid)}`, read: done }),
    feedbackSet: (req) =>
      call({
        method: 'PUT',
        route: `/ai/conversations/${enc(req.conversationId)}/messages/${enc(req.messageId)}/feedback`,
        json: {
          rating: req.rating,
          ...(req.reason ? { reason: req.reason } : {}),
          ...(req.note ? { note: req.note } : {}),
        },
        read: done,
      }),
    feedbackClear: (cid, mid) =>
      call({
        method: 'DELETE',
        route: `/ai/conversations/${enc(cid)}/messages/${enc(mid)}/feedback`,
        read: done,
      }),
  }
}
