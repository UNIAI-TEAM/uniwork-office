/**
 * aiStream / aiChat in the frame (the desktop runs them in the main process, e.g.
 * apps/slides/src/main/ai-ipc.ts `ai:stream`): the same ai-provider protocol code, the same
 * AiStreamChunk sequence (delta / reasoning / tool-call / ping, then one done or error), with the
 * base URL pointed at the BYOK proxy route of the chosen provider and no key in the config.
 *
 * The protocol modules are imported one by one (not the package index): the index also pulls the
 * Codex app-server bridge, which needs Node. Codex and Genspark have no web route; a request for
 * them, or for a provider the server table does not list, fails with `credential_missing`.
 */
import type { AgentMessage, AgentToolDef } from '@genoffice/agent-core'
import { setPrimaryFetch } from '../../../../packages/ai-provider/src/fetch'
import { isAiNetworkError } from '../../../../packages/ai-provider/src/network-error'
import { isAiOverloadedError } from '../../../../packages/ai-provider/src/overload-error'
import { withOutputCapFallback } from '../../../../packages/ai-provider/src/output-cap'
import {
  chatAnthropic,
  streamAnthropic,
} from '../../../../packages/ai-provider/src/protocols/anthropic'
import { chatGemini, streamGemini } from '../../../../packages/ai-provider/src/protocols/gemini'
import {
  chatOpenAiCompatible,
  streamOpenAiCompatible,
} from '../../../../packages/ai-provider/src/protocols/openai-compatible'
import { AiCreditsError } from '../../../../packages/ai-provider/src/protocols/shared'
import { maxOutputTokensOf } from '../../../../packages/ai-provider/src/providers'
import {
  getProviderAdapter,
  type ResolvedEndpoint,
} from '../../../../packages/ai-provider/src/registry'
import type {
  AiChatResponse,
  AiProviderConfig,
  AiProviderId,
  AiSettings,
  AiStreamChunk,
  AiStreamRequest,
} from '../../../../packages/ai-provider/src/types'
import {
  AI_CHAT_RESPONSE_TIMEOUT_MS,
  AiTimeoutError,
  createStreamWatchdog,
} from '../../../../packages/ai-provider/src/watchdog'
import type { AiWebClient } from './client'
import { AiWebError, isAiWebError } from './errors'
import { createProxyFetch } from './transport'

export type WireProtocol = 'openai-compatible' | 'anthropic' | 'gemini'

export interface StreamDeps {
  client: Pick<AiWebClient, 'base' | 'fetch'>
  /** the server's wire protocol of a provider id (from GET credentials `providers`); null = unknown */
  protocolOf(provider: string): WireProtocol | null
  /** the localized text of a typed failure (the panel shows it as the turn's error) */
  describe(error: AiWebError, provider: string): string
  /** a typed failure happened (the bridge raises its in-frame state card) */
  onTypedError?(error: AiWebError, provider: string): void
}

/** the request config ai-provider sees: proxy base URL, no key */
export function proxyConfig(
  client: Pick<AiWebClient, 'base'>,
  provider: AiProviderId,
  settings: AiSettings,
): AiProviderConfig {
  const own = settings.providers?.[provider]
  return {
    apiKey: '',
    model: own?.model ?? '',
    baseUrl: `${client.base}/byok/${encodeURIComponent(provider)}`,
  }
}

/** protocol = the server's; request shaping (temperature, token field, body extras) = the adapter's */
export function resolveWebEndpoint(
  provider: AiProviderId,
  config: AiProviderConfig,
  protocol: WireProtocol,
): ResolvedEndpoint & { protocol: WireProtocol } {
  let shaping: Partial<ResolvedEndpoint> = {}
  try {
    const native = getProviderAdapter(provider).resolveEndpoint(config)
    if (native.protocol === protocol) shaping = native
  } catch {
    // an id the adapter table does not know: plain request shaping
  }
  return {
    ...(shaping.omitTemperature ? { omitTemperature: true } : {}),
    ...(shaping.useMaxCompletionTokens ? { useMaxCompletionTokens: true } : {}),
    ...(shaping.bodyExtras ? { bodyExtras: shaping.bodyExtras } : {}),
    protocol,
    baseUrl: config.baseUrl ?? '',
  }
}

let installedFor: unknown = null

/** route every ai-provider fetch of this frame through the proxy (idempotent per client) */
export function installProxyTransport(client: Pick<AiWebClient, 'base' | 'fetch'>): void {
  if (installedFor === client) return
  installedFor = client
  setPrimaryFetch(createProxyFetch(client))
}

function missing(provider: string): AiWebError {
  return new AiWebError({ code: 'credential_missing', status: 404, message: provider })
}

export function errorCodeOf(err: unknown): AiStreamChunk['errorCode'] | undefined {
  if (err instanceof AiTimeoutError) return 'timeout'
  if (err instanceof AiCreditsError) return 'credits'
  if (isAiNetworkError(err)) return 'network'
  if (isAiOverloadedError(err)) return 'overloaded'
  return undefined
}

export interface WebAiStreams {
  aiStream(request: AiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
  aiChat(request: { settings: AiSettings; system: string; user: string }): Promise<AiChatResponse>
}

export function createWebAiStreams(deps: StreamDeps): WebAiStreams {
  const listeners = new Set<(chunk: AiStreamChunk) => void>()
  const active = new Map<string, AbortController>()

  const emit = (chunk: AiStreamChunk): void => {
    for (const listener of [...listeners]) {
      try {
        listener(chunk)
      } catch (err) {
        console.error('[web-ai] onAiStream listener threw', err)
      }
    }
  }

  const typed = (err: AiWebError, provider: string): string => {
    deps.onTypedError?.(err, provider)
    return deps.describe(err, provider)
  }

  async function aiStream(request: AiStreamRequest): Promise<void> {
    const { requestId, settings, system, messages } = request
    const provider = settings.provider
    const protocol = deps.protocolOf(provider)
    if (!protocol) {
      emit({ requestId, type: 'error', error: typed(missing(provider), provider) })
      return
    }
    installProxyTransport(deps.client)
    const config = proxyConfig(deps.client, provider, settings)
    const endpoint = resolveWebEndpoint(provider, config, protocol)
    const tools: AgentToolDef[] = request.tools ?? []
    const maxTokens = request.maxTokens ?? maxOutputTokensOf(settings)
    const controller = new AbortController()
    active.set(requestId, controller)
    let lastPing = 0
    const ping = (): void => {
      const now = Date.now()
      if (now - lastPing < 5_000) return
      lastPing = now
      emit({ requestId, type: 'ping' })
    }
    let stopReason: string | undefined
    const cb = {
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      signal: controller.signal,
      onDelta: (text: string) => emit({ requestId, type: 'delta', text }),
      onReasoningDelta: (text: string) => emit({ requestId, type: 'reasoning', text }),
      onToolCall: (toolCall: NonNullable<AiStreamChunk['toolCall']>) =>
        emit({ requestId, type: 'tool-call', toolCall }),
      onActivity: ping,
      onStopReason: (reason: string) => {
        stopReason = reason
      },
    }
    try {
      await withOutputCapFallback(endpoint.baseUrl, config.model, maxTokens, (cap) =>
        runTurn(endpoint, config, system, messages, tools, cap, cb),
      )
      emit(
        stopReason === undefined
          ? { requestId, type: 'done' }
          : { requestId, type: 'done', stopReason },
      )
    } catch (err) {
      if (controller.signal.aborted) {
        emit({ requestId, type: 'done' })
      } else if (isAiWebError(err)) {
        emit({ requestId, type: 'error', error: typed(err, provider) })
      } else {
        const code = errorCodeOf(err)
        emit({
          requestId,
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
          ...(code ? { errorCode: code } : {}),
        })
      }
    } finally {
      active.delete(requestId)
    }
  }

  async function aiChat(request: {
    settings: AiSettings
    system: string
    user: string
  }): Promise<AiChatResponse> {
    const provider = request.settings.provider
    const protocol = deps.protocolOf(provider)
    if (!protocol) return { ok: false, error: typed(missing(provider), provider) }
    installProxyTransport(deps.client)
    const config = proxyConfig(deps.client, provider, request.settings)
    const endpoint = resolveWebEndpoint(provider, config, protocol)
    const wd = createStreamWatchdog(undefined, AI_CHAT_RESPONSE_TIMEOUT_MS)
    try {
      return await wd.guard(() => {
        switch (endpoint.protocol) {
          case 'anthropic':
            return chatAnthropic(wd, config, request.system, request.user, endpoint.baseUrl)
          case 'gemini':
            return chatGemini(wd, config, request.system, request.user, endpoint.baseUrl, {
              omitTemperature: endpoint.omitTemperature,
            })
          case 'openai-compatible':
            return chatOpenAiCompatible(
              wd,
              endpoint.baseUrl,
              config,
              request.system,
              request.user,
              {
                omitTemperature: endpoint.omitTemperature,
                bodyExtras: endpoint.bodyExtras,
              },
            )
        }
      })
    } catch (err) {
      if (isAiWebError(err)) return { ok: false, error: typed(err, provider) }
      const code = errorCodeOf(err)
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ...(code ? { errorCode: code } : {}),
      }
    }
  }

  return {
    aiStream,
    aiStreamCancel: async (requestId) => {
      active.get(requestId)?.abort()
    },
    onAiStream: (handler) => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
    aiChat,
  }
}

function runTurn(
  endpoint: ResolvedEndpoint & { protocol: WireProtocol },
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: Parameters<typeof streamAnthropic>[5],
): Promise<void> {
  switch (endpoint.protocol) {
    case 'anthropic':
      return streamAnthropic(config, system, messages, tools, maxTokens, cb, endpoint.baseUrl)
    case 'gemini':
      return streamGemini(config, system, messages, tools, maxTokens, cb, endpoint.baseUrl, {
        omitTemperature: endpoint.omitTemperature,
      })
    case 'openai-compatible':
      return streamOpenAiCompatible(
        endpoint.baseUrl,
        config,
        system,
        messages,
        tools,
        maxTokens,
        cb,
        {
          omitTemperature: endpoint.omitTemperature,
          useMaxCompletionTokens: endpoint.useMaxCompletionTokens,
          bodyExtras: endpoint.bodyExtras,
        },
      )
  }
}
