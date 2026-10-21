import {
  ASKUNI_MAX_RETRY_AFTER_SEC,
  type AskUniCitation,
  type AskUniCitationKind,
  type AskUniErrorCode,
  type AskUniNotice,
  type AskUniRequest,
  type AskUniResult,
} from '../../shared/askuni-api'
import {
  createUniworkSend,
  type UniworkDocsClientOptions,
  TRANSFER_TIMEOUT_MS,
} from '../uniwork-docs/client'
import { UniworkDocError } from '../uniwork-docs/errors'

/**
 * Ask UNI in the shell main process: `POST /workspaces/{ws}/ai/ask` (one JSON
 * body, not streamed) through the same hardened request every UniWork client
 * uses (device bearer added here only, one refresh on a 401, no redirects).
 * No model or effort is sent: the server default answers. Nothing here logs
 * the question, the answer or the token, and no failure throws: every outcome
 * is an AskUniResult the renderer can show.
 */

/** an answer can take a while (retrieval + model), longer than a metadata read */
const ASK_TIMEOUT_MS = TRANSFER_TIMEOUT_MS
const ID = /^[A-Za-z0-9_-]{1,128}$/
/** what the renderer receives from the server is bounded here, at the trust boundary */
const MAX_TITLE = 300
const MAX_QUOTE = 1000
const MAX_CONTENT = 20_000
/** a single-leading-slash path: no scheme, no `//host`, no backslash */
const SAFE_HREF = /^\/(?!\/)[^\\\s]*$/
/** control characters (and DEL) never belong in a link */
const hasControl = (value: string): boolean =>
  [...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)

export interface AskUniClient {
  ask(req: AskUniRequest): Promise<AskUniResult>
}

/** the server's citation kinds; the web calls the member kind `members`; any other kind is `other` */
const KINDS: Record<string, AskUniCitationKind> = {
  document: 'document',
  task: 'task',
  meeting: 'meeting',
  chat: 'chat',
  member: 'member',
  members: 'member',
}
const NOTICES: ReadonlySet<string> = new Set<AskUniNotice>(['no_sources', 'empty_answer'])

/** a failed call -> the contract's error code (offline only for "no answer at all") */
export function askUniCodeOfError(error: unknown): AskUniErrorCode {
  if (!(error instanceof UniworkDocError)) return 'error'
  const { status, serverCode } = error
  if (status === 402 || serverCode === 'ai_quota_exceeded') return 'quota'
  if (status === 429) return 'rate_limited'
  if (status === 503 && serverCode === 'ai_disabled') return 'disabled'
  if (status === 403 && serverCode) return 'forbidden'
  switch (error.code) {
    case 'network':
      return 'offline'
    case 'not_signed_in':
      return 'signed_out'
    case 'session_expired':
      return 'session'
    default:
      return 'error'
  }
}

function failure(error: unknown): AskUniResult {
  const code = askUniCodeOfError(error)
  if (
    code === 'rate_limited' &&
    error instanceof UniworkDocError &&
    error.retryAfterMs !== undefined
  ) {
    return {
      ok: false,
      code,
      retryAfterSec: Math.min(ASKUNI_MAX_RETRY_AFTER_SEC, Math.ceil(error.retryAfterMs / 1000)),
    }
  }
  return { ok: false, code }
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

function parseCitation(raw: unknown): AskUniCitation | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.kind !== 'string') return null
  const kind = Object.hasOwn(KINDS, c.kind) ? KINDS[c.kind] : 'other'
  const sourceId = text(c.source_id)
  const title = text(c.title)
  const quote = text(c.quote)
  const href = text(c.href)
  if (sourceId === null || title === null || quote === null || href === null) return null
  return {
    sourceId,
    kind,
    title: title.slice(0, MAX_TITLE),
    quote: quote.slice(0, MAX_QUOTE),
    // a bad href keeps the row, the app just offers no open for it
    href: SAFE_HREF.test(href) && !hasControl(href) ? href : '',
  }
}

function parseAnswer(raw: unknown): AskUniResult {
  const body = (raw ?? {}) as { conversation_id?: unknown; message?: unknown }
  const message = (body.message ?? {}) as Record<string, unknown>
  if (
    typeof body.conversation_id !== 'string' ||
    !ID.test(body.conversation_id) ||
    typeof message.id !== 'string' ||
    typeof message.content !== 'string'
  ) {
    throw new UniworkDocError('malformed_response')
  }
  const citations = Array.isArray(message.citations)
    ? message.citations.map(parseCitation).filter((c): c is AskUniCitation => c !== null)
    : []
  const notice = typeof message.notice === 'string' && NOTICES.has(message.notice)
  return {
    ok: true,
    conversationId: body.conversation_id,
    message: {
      id: message.id,
      content: message.content.slice(0, MAX_CONTENT),
      citations,
      ...(notice ? { notice: message.notice as AskUniNotice } : {}),
    },
  }
}

export function createAskUniClient(options: UniworkDocsClientOptions): AskUniClient {
  const send = createUniworkSend(options)
  return {
    async ask(req) {
      try {
        return await send({
          method: 'POST',
          route: `/workspaces/${encodeURIComponent(req.workspaceId)}/ai/ask`,
          json: {
            conversation_id: req.conversationId ?? '',
            question: req.question,
            locale: req.locale,
          },
          timeoutMs: options.metadataTimeoutMs ?? ASK_TIMEOUT_MS,
          read: async (response) => parseAnswer(await response.json()),
        })
      } catch (error) {
        return failure(error)
      }
    },
  }
}
