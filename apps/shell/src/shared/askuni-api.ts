// IPC contract for Ask UNI (workspace question answering over UniWork documents).
// Shared by the shell main client and the Home renderer; keep it dependency-free.

export const ASKUNI_CHANNELS = {
  ask: 'uniwork:askuni:ask',
  context: 'uniwork:askuni:context',
} as const

export type AskUniLocale = 'vi' | 'en'

export interface AskUniRequest {
  workspaceId: string
  conversationId?: string
  question: string
  locale: AskUniLocale
}

export type AskUniCitationKind = 'document' | 'task' | 'meeting' | 'chat' | 'member'

export interface AskUniCitation {
  sourceId: string
  kind: AskUniCitationKind
  title: string
  quote: string
  href: string
}

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

export interface AskUniBridge {
  uniworkAskUni(req: AskUniRequest): Promise<AskUniResult>
  uniworkAskUniContext(): Promise<AskUniContext>
}

const KINDS: ReadonlySet<string> = new Set<AskUniCitationKind>([
  'document',
  'task',
  'meeting',
  'chat',
  'member',
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
        ? { retryAfterSec: wait }
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
