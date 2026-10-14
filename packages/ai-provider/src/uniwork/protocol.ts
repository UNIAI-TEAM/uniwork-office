/**
 * The `uniwork` provider's wire protocol: one agent turn per request against
 * the UniWork façade (design: g6-05-design.md §3).
 *
 * Contract stub: the signature both hosts call. The implementation (slicing,
 * conversation/run ids, x_uniwork, Retry-After waits, real stream and
 * one-chunk SSE) replaces the body; nothing selects the provider yet.
 */
import type { AgentMessage, AgentToolDef } from '@genoffice/agent-core'
import type { StreamCallbacks } from '../protocols/shared'
import type { UniworkChatTransport, UniworkScope, UniworkToolPolicy } from './types'

export interface UniworkTurnRequest {
  scope: UniworkScope
  /** the loop's full history; the adapter sends only the new question or the trailing tool results */
  messages: AgentMessage[]
  tools: AgentToolDef[]
  toolPolicy: UniworkToolPolicy
}

export async function streamUniwork(
  _transport: UniworkChatTransport,
  _request: UniworkTurnRequest,
  _cb: StreamCallbacks,
): Promise<void> {
  throw new Error('UniWork AI adapter is not implemented yet')
}
