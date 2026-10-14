import type { AgentMessage, AgentToolDef } from '@genoffice/agent-core'
import { withOutputCapFallback } from './output-cap'
import { streamAnthropic } from './protocols/anthropic'
import { streamGemini } from './protocols/gemini'
import { streamOpenAiCompatible } from './protocols/openai-compatible'
import { streamCodexAppServer } from './codex-app-server'
import type { StreamCallbacks } from './protocols/shared'
import { getProviderAdapter, type AiProtocol } from './registry'
import type { AiProviderConfig, AiProviderId } from './types'
import { uniworkConversations } from './uniwork/conversation'
import { UniworkError } from './uniwork/errors'
import { streamUniwork } from './uniwork/protocol'
import { uniworkChatTransport } from './uniwork/transport'
import type { UniworkChatTransport, UniworkScope, UniworkToolPolicy } from './uniwork/types'

export { streamAnthropic } from './protocols/anthropic'
export { streamGemini } from './protocols/gemini'
export { streamOpenAiCompatible } from './protocols/openai-compatible'
export { AiCreditsError, sseLines } from './protocols/shared'
export type { StreamCallbacks } from './protocols/shared'

/** what a UniWork AI turn needs besides the loop's request (the host knows it, the loop does not) */
export interface UniworkStreamContext {
  /** the route of the turn (document, organization + format, or web frame) */
  scope: UniworkScope
  toolPolicy: UniworkToolPolicy
  /** the session transport; the one the host installed (setUniworkChatTransport) by default */
  transport?: UniworkChatTransport | undefined
}

/**
 * Route a streaming, tool-calling-capable turn by provider id. `uniwork`
 * goes to the UniWork AI adapter (no BYOK endpoint, no key, no system prompt:
 * the server keeps the instructions and the conversation); every other turn
 * is recorded on the panel session so a later UniWork AI turn knows the
 * provider changed.
 */
export async function streamForProvider(
  provider: AiProviderId,
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
  uniwork?: UniworkStreamContext,
): Promise<void> {
  if (provider === 'uniwork') {
    const transport = uniwork?.transport ?? uniworkChatTransport()
    // no session transport: signed out (or a process without one)
    if (!transport) throw new UniworkError('session_expired')
    if (!uniwork) throw new UniworkError('protocol_error')
    return streamUniwork(transport, { scope: uniwork.scope, messages, tools, toolPolicy: uniwork.toolPolicy }, cb)
  }
  uniworkConversations.observe(cb.sessionId, provider)
  const endpoint = getProviderAdapter(provider).resolveEndpoint(config)
  const { baseUrl } = endpoint
  if (endpoint.model) config = { ...config, model: endpoint.model }
  if (endpoint.protocol === 'codex-app-server') {
    return streamCodexAppServer(config, system, messages, tools, maxTokens, cb)
  }
  const protocol: Exclude<AiProtocol, 'codex-app-server'> = endpoint.protocol
  return withOutputCapFallback(baseUrl, config.model, maxTokens, (cap) => {
    switch (protocol) {
      case 'anthropic':
        return streamAnthropic(config, system, messages, tools, cap, cb, baseUrl)
      case 'gemini':
        return streamGemini(config, system, messages, tools, cap, cb, baseUrl, {
          omitTemperature: endpoint.omitTemperature,
        })
      case 'openai-compatible':
        return streamOpenAiCompatible(baseUrl, config, system, messages, tools, cap, cb, {
          omitTemperature: endpoint.omitTemperature,
          useMaxCompletionTokens: endpoint.useMaxCompletionTokens,
          bodyExtras: endpoint.bodyExtras,
        })
    }
  })
}
