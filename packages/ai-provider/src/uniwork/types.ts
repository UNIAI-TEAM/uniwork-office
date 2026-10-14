/**
 * UniWork AI adapter: the shared types of the `uniwork` provider.
 *
 * UniWork AI is the organization's server-side model behind the UniWork
 * façade (openai-compatible, one agent turn per request). The server keeps
 * the conversation: every request carries only the user's new question or
 * the tool results of the call the server just issued, plus the conversation
 * and run ids the server handed out. It is never a BYOK pass-through.
 *
 * Seam file: the adapter (protocol, slicing, conversation, Retry-After) and
 * both hosts (shell main process, web frame) build on these types. Nothing
 * here does I/O; the host injects the transport (./transport.ts).
 */
import type { AgentDroppedToolCall, AgentStreamNotice } from '@genoffice/agent-core'

export const UNIWORK_PROVIDER_ID = 'uniwork' as const

/** server-issued conversation id: sent back to continue; absent = start a new conversation */
export const UNIWORK_CONVERSATION_HEADER = 'X-UniWork-AI-Conversation'
/** server-issued run id: sent on every later turn of the run (tool results, a retry after 429) */
export const UNIWORK_RUN_HEADER = 'X-UniWork-AI-Run'

/** waits for Retry-After within one turn before giving up */
export const UNIWORK_MAX_RATE_LIMIT_WAITS = 3
/** a Retry-After above this many seconds is not waited out (give up at once) */
export const UNIWORK_RETRY_AFTER_CAP_SECONDS = 300

/** the format token of the module the turn runs in (`office_ai_uniwork_<token>`, `module` in the body) */
export type UniworkFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'markdown' | 'html'

/**
 * Error codes the façade answers with (`{code, message, fields?}`). The
 * adapter branches on these, never on the message text.
 */
export type UniworkWireCode =
  | 'conversation_expired'
  | 'run_expired'
  | 'run_limit_reached'
  | 'credits_exhausted'
  | 'entitlement_required'
  | 'office_capability_off'
  | 'ai_rate_limited'
  | 'ai_uniwork_busy'
  | 'rate_limited'
  | 'ai_provider_timeout'
  | 'ai_provider_error'
  | 'provider_unreachable'
  | 'cloud_unavailable'
  | 'ai_disabled'
  | 'ai_tool_result_too_large'
  | 'payload_too_large'
  | 'invalid_request'

export type UniworkDroppedToolCall = AgentDroppedToolCall
export type UniworkNotice = AgentStreamNotice

/** the reserved end-of-stream frame (`x_uniwork.terminal`); the v1 server never sends it */
export interface UniworkTerminal {
  code: 'ai_rate_limited' | 'ai_provider_error' | 'ai_provider_timeout' | (string & {})
  /** seconds, only with ai_rate_limited */
  retry_after?: number
}

/** `x_uniwork` on a successful answer (chat.completion or the SSE chunk that carries it) */
export interface UniworkExtension {
  dropped_tool_calls?: UniworkDroppedToolCall[]
  /** tool rounds of the run after this answer (0 on the question turn) */
  step: number
  /** the run's tool-round cap */
  limit: number
  terminal?: UniworkTerminal
}

/** the ids a turn carries out and reads back */
export interface UniworkTurnIds {
  conversationId?: string
  runId?: string
}

/**
 * Which route a turn goes to. Desktop: a document bound to UniWork goes to
 * the document route (the server derives org and module from the document);
 * a local file goes to the organization route with `module`. Web: the frame
 * route (identity and module come from the frame token).
 */
export type UniworkScope =
  | { kind: 'document'; documentId: string; format: UniworkFormat }
  | { kind: 'org'; orgId: string; format: UniworkFormat }
  | { kind: 'frame'; documentId: string; format: UniworkFormat }

/** one request of a turn as the adapter hands it to the host transport */
export interface UniworkChatRequest {
  scope: UniworkScope
  /** the two id headers (when known) and Content-Type; the transport adds auth itself */
  headers: Record<string, string>
  /** JSON body: { messages, tools?, stream: true, module? } */
  body: string
  signal: AbortSignal
}

/**
 * Host-injected transport: performs one POST on the scope's route and
 * resolves with the raw Response, non-2xx included (the adapter reads the
 * status, the `code` and the id headers itself). A rejection means the
 * request never got an answer (offline, aborted).
 */
export interface UniworkChatTransport {
  post(request: UniworkChatRequest): Promise<Response>
}

/** which tools may go out with a turn (the module editor tools; cloud tools only with office.ai_cloud) */
export interface UniworkToolPolicy {
  /** the organization has office.ai_cloud and the cloud tools are on */
  cloudTools: boolean
}
