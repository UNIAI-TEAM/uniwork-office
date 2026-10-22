// IPC contract for Ask UNI (workspace question answering over UniWork documents).
// The P1 shapes live here (shell only); everything the editors share too (v2
// stream + REST, citations, error sets, validators) is in
// @genoffice/ai-provider/askuni and re-exported, so shell imports stay as they are.

import {
  ASKUNI_ERROR_CODES,
  asAskUniCitation,
  type AskUniCitation,
  type AskUniCitationKind,
  type AskUniErrorCode,
  type AskUniLocale,
  type AskUniNotice,
  ASKUNI_MAX_RETRY_AFTER_SEC,
} from '@genoffice/ai-provider/askuni'

export * from '@genoffice/ai-provider/askuni'

export const ASKUNI_CHANNELS = {
  ask: 'uniwork:askuni:ask',
  context: 'uniwork:askuni:context',
  openCitation: 'uniwork:askuni:open-citation',
} as const

export interface AskUniRequest {
  workspaceId: string
  conversationId?: string
  question: string
  locale: AskUniLocale
}

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

const CODES = ASKUNI_ERROR_CODES
const isStr = (v: unknown): v is string => typeof v === 'string'
const asCitation = asAskUniCitation

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
