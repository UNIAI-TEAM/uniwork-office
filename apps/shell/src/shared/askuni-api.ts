// IPC contract for Ask UNI (workspace question answering over UniWork documents).
// Shared by the shell main client and the Home renderer; keep it dependency-free.

export const ASKUNI_CHANNELS = {
  ask: 'uniwork:askuni:ask',
  context: 'uniwork:askuni:context',
  openCitation: 'uniwork:askuni:open-citation',
} as const

export type AskUniLocale = 'vi' | 'en'

export interface AskUniRequest {
  workspaceId: string
  conversationId?: string
  question: string
  locale: AskUniLocale
}

/** `other`: any kind the app has no row for (project, workload, email thread, ...) */
export type AskUniCitationKind = 'document' | 'task' | 'meeting' | 'chat' | 'member' | 'other'

export interface AskUniCitation {
  sourceId: string
  kind: AskUniCitationKind
  title: string
  quote: string
  href: string
}

/** the longest wait a rate-limit reply can ask the composer to count down */
export const ASKUNI_MAX_RETRY_AFTER_SEC = 3600

export type AskUniNotice = 'no_sources' | 'empty_answer'

export type AskUniErrorCode =
  | 'offline'
  | 'signed_out'
  | 'forbidden'
  | 'quota'
  | 'rate_limited'
  | 'disabled'
  | 'session'
  | 'error'

export type AskUniResult =
  | {
      ok: true
      conversationId: string
      message: {
        id: string
        content: string
        citations: AskUniCitation[]
        notice?: AskUniNotice
      }
    }
  | { ok: false; code: AskUniErrorCode; retryAfterSec?: number }

export interface AskUniWorkspace {
  id: string
  name: string
}

export interface AskUniContext {
  workspaces: AskUniWorkspace[]
  currentWorkspaceId: string | null
  signedIn: boolean
}

/** what the renderer may ask to open: a citation's kind and its server path, never a URL */
export interface AskUniOpenRequest {
  kind: AskUniCitationKind
  href: string
}

export type AskUniOpenResult = { ok: true } | { ok: false; code: AskUniErrorCode }

export interface AskUniBridge {
  uniworkAskUni(req: AskUniRequest): Promise<AskUniResult>
  uniworkAskUniContext(): Promise<AskUniContext>
  /** a document opens in the app, any other kind as the server's web page (main decides, see open-citation.ts) */
  uniworkAskUniOpenCitation(req: AskUniOpenRequest): Promise<AskUniOpenResult>
}

const KINDS: ReadonlySet<string> = new Set<AskUniCitationKind>([
  'document',
  'task',
  'meeting',
  'chat',
  'member',
  'other',
])
const CODES: ReadonlySet<string> = new Set<AskUniErrorCode>([
  'offline',
  'signed_out',
  'forbidden',
  'quota',
  'rate_limited',
  'disabled',
  'session',
  'error',
])
const isStr = (v: unknown): v is string => typeof v === 'string'

function asCitation(raw: unknown): AskUniCitation | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (!isStr(c.kind) || !KINDS.has(c.kind)) return null
  if (!isStr(c.sourceId) || !isStr(c.title) || !isStr(c.quote) || !isStr(c.href)) return null
  return {
    sourceId: c.sourceId,
    kind: c.kind as AskUniCitationKind,
    title: c.title,
    quote: c.quote,
    href: c.href,
  }
}

/** the preload's check of a main reply: anything not shaped like an AskUniResult is an `error` */
export function asAskUniResult(raw: unknown): AskUniResult {
  const bad: AskUniResult = { ok: false, code: 'error' }
  if (!raw || typeof raw !== 'object') return bad
  const r = raw as Record<string, unknown>
  if (r.ok === false) {
    if (!isStr(r.code) || !CODES.has(r.code)) return bad
    const wait = r.retryAfterSec
    return {
      ok: false,
      code: r.code as AskUniErrorCode,
      ...(typeof wait === 'number' && Number.isFinite(wait) && wait >= 0
        ? { retryAfterSec: Math.min(ASKUNI_MAX_RETRY_AFTER_SEC, wait) }
        : {}),
    }
  }
  const m = r.message
  if (r.ok !== true || !isStr(r.conversationId) || !m || typeof m !== 'object') return bad
  const msg = m as Record<string, unknown>
  if (!isStr(msg.id) || !isStr(msg.content) || !Array.isArray(msg.citations)) return bad
  return {
    ok: true,
    conversationId: r.conversationId,
    message: {
      id: msg.id,
      content: msg.content,
      citations: msg.citations.map(asCitation).filter((c): c is AskUniCitation => c !== null),
      ...(msg.notice === 'no_sources' || msg.notice === 'empty_answer'
        ? { notice: msg.notice as AskUniNotice }
        : {}),
    },
  }
}

/** the preload's check of the context reply: anything else is the signed-out empty context */
export function asAskUniContext(raw: unknown): AskUniContext {
  const none: AskUniContext = { workspaces: [], currentWorkspaceId: null, signedIn: false }
  if (!raw || typeof raw !== 'object') return none
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.workspaces) || typeof r.signedIn !== 'boolean') return none
  const workspaces = r.workspaces.flatMap((w): AskUniWorkspace[] => {
    const row = (w ?? {}) as Record<string, unknown>
    return isStr(row.id) && isStr(row.name) ? [{ id: row.id, name: row.name }] : []
  })
  const current = isStr(r.currentWorkspaceId) ? r.currentWorkspaceId : null
  return {
    workspaces,
    currentWorkspaceId: workspaces.some((w) => w.id === current) ? current : null,
    signedIn: r.signedIn,
  }
}

/** the preload's check of an open reply: anything not shaped like an AskUniOpenResult is an `error` */
export function asAskUniOpenResult(raw: unknown): AskUniOpenResult {
  const bad: AskUniOpenResult = { ok: false, code: 'error' }
  if (!raw || typeof raw !== 'object') return bad
  const r = raw as Record<string, unknown>
  if (r.ok === true) return { ok: true }
  if (r.ok === false && isStr(r.code) && CODES.has(r.code)) {
    return { ok: false, code: r.code as AskUniErrorCode }
  }
  return bad
}

// ---------------------------------------------------------------------------
// Ask UNI v2: the streamed answer (`POST /workspaces/{ws}/ai/ask/stream`) and
// the conversation REST routes. Main holds the session (bearer, SSE parse,
// bounds); the renderer gets validated events on its own webContents only.
// The P1 types above stay for the legacy pane (`ask_uni_stream` off).
// ---------------------------------------------------------------------------

export const ASKUNI_V2_CHANNELS = {
  /** handle: AskUniStreamRequest -> AskUniStreamStart */
  stream: 'uniwork:askuni:stream',
  /** handle: { requestId } -> { ok: true } | { ok: false, error } (own requests only) */
  streamCancel: 'uniwork:askuni:stream-cancel',
  /** main -> the asking webContents only: AskUniStreamEvent */
  streamEvent: 'uniwork:askuni:stream-event',
  /** handle: () -> AskUniFlags */
  flags: 'uniwork:askuni:flags',
  capabilities: 'uniwork:askuni:capabilities',
  conversations: 'uniwork:askuni:conversations',
  messages: 'uniwork:askuni:messages',
  rename: 'uniwork:askuni:rename',
  delete: 'uniwork:askuni:delete',
  feedbackSet: 'uniwork:askuni:feedback-set',
  feedbackClear: 'uniwork:askuni:feedback-clear',
  lookup: 'uniwork:askuni:lookup',
} as const

/** the object a question is about (server AskUniFocusSDI kinds) */
export type AskUniFocusKind = 'task' | 'meeting' | 'email_thread' | 'document' | 'project' | 'room'
/** an object the asker @-mentions (server mention kinds) */
export type AskUniMentionKind = 'task' | 'meeting' | 'document' | 'project' | 'member'
/** every kind a picker can look up (focus + mention kinds) */
export type AskUniObjectKind = AskUniFocusKind | AskUniMentionKind

export const ASKUNI_FOCUS_KINDS: readonly AskUniFocusKind[] = [
  'task',
  'meeting',
  'email_thread',
  'document',
  'project',
  'room',
]
export const ASKUNI_MENTION_KINDS: readonly AskUniMentionKind[] = [
  'task',
  'meeting',
  'document',
  'project',
  'member',
]
export const ASKUNI_MAX_MENTIONS = 5
export const ASKUNI_MAX_TITLE = 80
export const ASKUNI_MAX_FEEDBACK_NOTE = 500
export const ASKUNI_MAX_LOOKUP_RESULTS = 20

/** '' = Auto (the server's default model) */
export type AskUniModel = '' | 'haiku' | 'sonnet' | 'opus'
export type AskUniEffort = 'low' | 'medium' | 'high'

export interface AskUniObjectRef<K extends string = AskUniObjectKind> {
  kind: K
  id: string
}

export interface AskUniStreamRequest {
  workspaceId: string
  conversationId?: string
  question: string
  locale: AskUniLocale
  focus?: AskUniObjectRef<AskUniFocusKind>
  /** at most ASKUNI_MAX_MENTIONS */
  mentions?: AskUniObjectRef<AskUniMentionKind>[]
  model?: AskUniModel
  effort?: AskUniEffort
}

/**
 * The v2 error set: the P1 codes plus the server's `ai_*` gateway codes
 * (unknown codes map to `error`). `stream_ended` = the body ended without a
 * `done`; `cancelled` = the request was stopped (Stop, sign-out, a newer stream).
 */
export type AskUniV2ErrorCode =
  | AskUniErrorCode
  | 'provider_error'
  | 'provider_timeout'
  | 'cancelled'
  | 'output_invalid'
  | 'refused'
  | 'tool_not_allowed'
  | 'stream_ended'

/** `stopped`: the answer was cut by a Stop and stored as far as it got */
export type AskUniV2Notice = AskUniNotice | 'stopped'

export interface AskUniMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: AskUniCitation[]
  notice?: AskUniV2Notice
  createdAt: string
}

export interface AskUniStreamUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type AskUniFailure = { ok: false; error: AskUniV2ErrorCode; retryAfterSeconds?: number }

export type AskUniStreamStart = { ok: true; requestId: string } | AskUniFailure

export type AskUniStreamEvent =
  | { type: 'run'; requestId: string; conversationId: string; runId: string }
  | {
      type: 'step'
      requestId: string
      round: number
      phase: 'tool' | 'retry'
      tool: string
      counts: Record<string, number>
    }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'citations'; requestId: string; citations: AskUniCitation[] }
  | { type: 'done'; requestId: string; message: AskUniMessage; usage?: AskUniStreamUsage }
  | { type: 'error'; requestId: string; code: AskUniV2ErrorCode; retryAfterSeconds?: number }

export type AskUniStreamEventType = AskUniStreamEvent['type']
/** exactly one of these ends every request */
export const isAskUniTerminalEvent = (ev: AskUniStreamEvent): boolean =>
  ev.type === 'done' || ev.type === 'error'

export interface AskUniStreamCancelRequest {
  requestId: string
}
export type AskUniOkResult = { ok: true } | AskUniFailure

export interface AskUniFlags {
  /** the public `ask_uni_stream` flag of GET /api/v1/config; false when unknown */
  streamEnabled: boolean
}

// REST (main: S2)

export interface AskUniModelOption {
  key: Exclude<AskUniModel, ''>
  speed: number
  intelligence: number
  cost: number
  enabled: boolean
}
export interface AskUniCapabilities {
  enabled: boolean
  models: AskUniModelOption[]
  /** the model key Auto resolves to; '' when none */
  autoModel: string
}
export interface AskUniConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}
export type AskUniFeedbackRating = 'up' | 'down'
export type AskUniFeedbackReason = 'wrong_facts' | 'missing_sources' | 'not_helpful' | 'other'

export interface AskUniWorkspaceRequest {
  workspaceId: string
}
export interface AskUniConversationRequest {
  conversationId: string
}
export interface AskUniRenameRequest {
  conversationId: string
  /** 1-ASKUNI_MAX_TITLE characters after trimming */
  title: string
}
export interface AskUniFeedbackRequest {
  conversationId: string
  messageId: string
  rating: AskUniFeedbackRating
  reason?: AskUniFeedbackReason
  /** at most ASKUNI_MAX_FEEDBACK_NOTE characters */
  note?: string
}
export interface AskUniFeedbackClearRequest {
  conversationId: string
  messageId: string
}
export interface AskUniLookupRequest {
  workspaceId: string
  kind: AskUniObjectKind
  query: string
}
export interface AskUniLookupItem {
  kind: AskUniObjectKind
  id: string
  title: string
  subtitle?: string
}

export type AskUniCapabilitiesResult = ({ ok: true } & AskUniCapabilities) | AskUniFailure
export type AskUniConversationsResult =
  { ok: true; conversations: AskUniConversation[] } | AskUniFailure
export type AskUniMessagesResult = { ok: true; messages: AskUniMessage[] } | AskUniFailure
/** at most ASKUNI_MAX_LOOKUP_RESULTS items */
export type AskUniLookupResult = { ok: true; items: AskUniLookupItem[] } | AskUniFailure

/** renderer-facing v2 methods on window.aiOffice */
export interface AskUniV2Bridge {
  /** starts a streamed answer; events arrive through onAskUniStreamEvent with this requestId */
  askUniStream(req: AskUniStreamRequest): Promise<AskUniStreamStart>
  askUniStreamCancel(req: AskUniStreamCancelRequest): Promise<AskUniOkResult>
  /** returns the unsubscribe */
  onAskUniStreamEvent(cb: (ev: AskUniStreamEvent) => void): () => void
  askUniFlags(): Promise<AskUniFlags>
  askUniCapabilities(req: AskUniWorkspaceRequest): Promise<AskUniCapabilitiesResult>
  askUniConversations(req: AskUniWorkspaceRequest): Promise<AskUniConversationsResult>
  askUniMessages(req: AskUniConversationRequest): Promise<AskUniMessagesResult>
  askUniRename(req: AskUniRenameRequest): Promise<AskUniOkResult>
  askUniDelete(req: AskUniConversationRequest): Promise<AskUniOkResult>
  askUniFeedbackSet(req: AskUniFeedbackRequest): Promise<AskUniOkResult>
  askUniFeedbackClear(req: AskUniFeedbackClearRequest): Promise<AskUniOkResult>
  askUniLookup(req: AskUniLookupRequest): Promise<AskUniLookupResult>
}

// v2 validators the preload runs on every main reply / pushed event

const V2_CODES: ReadonlySet<string> = new Set<AskUniV2ErrorCode>([
  ...(CODES as ReadonlySet<AskUniErrorCode>),
  'provider_error',
  'provider_timeout',
  'cancelled',
  'output_invalid',
  'refused',
  'tool_not_allowed',
  'stream_ended',
])
const V2_NOTICES: ReadonlySet<string> = new Set<AskUniV2Notice>([
  'no_sources',
  'empty_answer',
  'stopped',
])
const OBJECT_KINDS: ReadonlySet<string> = new Set<AskUniObjectKind>([
  ...ASKUNI_FOCUS_KINDS,
  ...ASKUNI_MENTION_KINDS,
])
const MODEL_KEYS: ReadonlySet<string> = new Set(['haiku', 'sonnet', 'opus'])
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

function asRetry(v: unknown): { retryAfterSeconds?: number } {
  return isCount(v) ? { retryAfterSeconds: Math.min(ASKUNI_MAX_RETRY_AFTER_SEC, v) } : {}
}

/** a failure reply, or null when `raw` is not one */
function asFailure(raw: Record<string, unknown>): AskUniFailure | null {
  if (raw.ok !== false) return null
  const error = isStr(raw.error) && V2_CODES.has(raw.error) ? raw.error : 'error'
  return { ok: false, error: error as AskUniV2ErrorCode, ...asRetry(raw.retryAfterSeconds) }
}

const BAD: AskUniFailure = { ok: false, error: 'error' }

export function asAskUniMessage(raw: unknown): AskUniMessage | null {
  if (!isObj(raw)) return null
  if (!isStr(raw.id) || !isStr(raw.content) || !isStr(raw.createdAt)) return null
  if (raw.role !== 'user' && raw.role !== 'assistant') return null
  return {
    id: raw.id,
    role: raw.role,
    content: raw.content,
    citations: Array.isArray(raw.citations)
      ? raw.citations.map(asCitation).filter((c): c is AskUniCitation => c !== null)
      : [],
    ...(isStr(raw.notice) && V2_NOTICES.has(raw.notice)
      ? { notice: raw.notice as AskUniV2Notice }
      : {}),
    createdAt: raw.createdAt,
  }
}

function asUsage(raw: unknown): AskUniStreamUsage | undefined {
  if (!isObj(raw)) return undefined
  const n = (v: unknown): number => (isCount(v) ? v : 0)
  return {
    inputTokens: n(raw.inputTokens),
    outputTokens: n(raw.outputTokens),
    cacheReadTokens: n(raw.cacheReadTokens),
    cacheWriteTokens: n(raw.cacheWriteTokens),
  }
}

export function asAskUniStreamStart(raw: unknown): AskUniStreamStart {
  if (!isObj(raw)) return BAD
  if (raw.ok === true && isStr(raw.requestId) && raw.requestId) {
    return { ok: true, requestId: raw.requestId }
  }
  return asFailure(raw) ?? BAD
}

/** the preload's check of a pushed event: null (dropped) when it is not one */
export function asAskUniStreamEvent(raw: unknown): AskUniStreamEvent | null {
  if (!isObj(raw) || !isStr(raw.requestId) || !raw.requestId) return null
  const requestId = raw.requestId
  switch (raw.type) {
    case 'run':
      return isStr(raw.conversationId) && isStr(raw.runId)
        ? { type: 'run', requestId, conversationId: raw.conversationId, runId: raw.runId }
        : null
    case 'step': {
      if (!isCount(raw.round) || (raw.phase !== 'tool' && raw.phase !== 'retry')) return null
      const counts: Record<string, number> = {}
      if (isObj(raw.counts)) {
        for (const [k, v] of Object.entries(raw.counts)) if (isCount(v)) counts[k] = v
      }
      return {
        type: 'step',
        requestId,
        round: raw.round,
        phase: raw.phase,
        tool: isStr(raw.tool) ? raw.tool : '',
        counts,
      }
    }
    case 'delta':
      return isStr(raw.text) ? { type: 'delta', requestId, text: raw.text } : null
    case 'citations':
      return Array.isArray(raw.citations)
        ? {
            type: 'citations',
            requestId,
            citations: raw.citations.map(asCitation).filter((c): c is AskUniCitation => c !== null),
          }
        : null
    case 'done': {
      const message = asAskUniMessage(raw.message)
      if (!message) return null
      const usage = asUsage(raw.usage)
      return { type: 'done', requestId, message, ...(usage ? { usage } : {}) }
    }
    case 'error': {
      const code = isStr(raw.code) && V2_CODES.has(raw.code) ? raw.code : 'error'
      return {
        type: 'error',
        requestId,
        code: code as AskUniV2ErrorCode,
        ...asRetry(raw.retryAfterSeconds),
      }
    }
    default:
      return null
  }
}

export function asAskUniFlags(raw: unknown): AskUniFlags {
  return { streamEnabled: isObj(raw) && raw.streamEnabled === true }
}

export function asAskUniOkResult(raw: unknown): AskUniOkResult {
  if (!isObj(raw)) return BAD
  if (raw.ok === true) return { ok: true }
  return asFailure(raw) ?? BAD
}

export function asAskUniCapabilitiesResult(raw: unknown): AskUniCapabilitiesResult {
  if (!isObj(raw)) return BAD
  if (raw.ok !== true) return asFailure(raw) ?? BAD
  if (typeof raw.enabled !== 'boolean' || !Array.isArray(raw.models)) return BAD
  const models = raw.models.flatMap((m): AskUniModelOption[] => {
    if (!isObj(m) || !isStr(m.key) || !MODEL_KEYS.has(m.key)) return []
    if (!isCount(m.speed) || !isCount(m.intelligence) || !isCount(m.cost)) return []
    if (typeof m.enabled !== 'boolean') return []
    return [
      {
        key: m.key as AskUniModelOption['key'],
        speed: m.speed,
        intelligence: m.intelligence,
        cost: m.cost,
        enabled: m.enabled,
      },
    ]
  })
  return {
    ok: true,
    enabled: raw.enabled,
    models,
    autoModel: isStr(raw.autoModel) ? raw.autoModel : '',
  }
}

export function asAskUniConversationsResult(raw: unknown): AskUniConversationsResult {
  if (!isObj(raw)) return BAD
  if (raw.ok !== true) return asFailure(raw) ?? BAD
  if (!Array.isArray(raw.conversations)) return BAD
  const conversations = raw.conversations.flatMap((c): AskUniConversation[] =>
    isObj(c) && isStr(c.id) && isStr(c.title) && isStr(c.createdAt) && isStr(c.updatedAt)
      ? [{ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt }]
      : [],
  )
  return { ok: true, conversations }
}

export function asAskUniMessagesResult(raw: unknown): AskUniMessagesResult {
  if (!isObj(raw)) return BAD
  if (raw.ok !== true) return asFailure(raw) ?? BAD
  if (!Array.isArray(raw.messages)) return BAD
  const messages = raw.messages.map(asAskUniMessage).filter((m): m is AskUniMessage => m !== null)
  return { ok: true, messages }
}

export function asAskUniLookupResult(raw: unknown): AskUniLookupResult {
  if (!isObj(raw)) return BAD
  if (raw.ok !== true) return asFailure(raw) ?? BAD
  if (!Array.isArray(raw.items)) return BAD
  const items = raw.items
    .flatMap((i): AskUniLookupItem[] =>
      isObj(i) && isStr(i.kind) && OBJECT_KINDS.has(i.kind) && isStr(i.id) && isStr(i.title)
        ? [
            {
              kind: i.kind as AskUniObjectKind,
              id: i.id,
              title: i.title,
              ...(isStr(i.subtitle) ? { subtitle: i.subtitle } : {}),
            },
          ]
        : [],
    )
    .slice(0, ASKUNI_MAX_LOOKUP_RESULTS)
  return { ok: true, items }
}
