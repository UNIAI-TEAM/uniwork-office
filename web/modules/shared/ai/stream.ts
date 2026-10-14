/**
 * aiStream / aiChat in the frame (the desktop runs them in the main process, e.g.
 * apps/slides/src/main/ai-ipc.ts `ai:stream`): the same ai-provider protocol code, the same
 * AiStreamChunk sequence (delta / reasoning / tool-call / ping, then one done or error), with the
 * base URL pointed at the BYOK proxy route of the chosen provider and no key in the config.
 *
 * The protocol modules are imported one by one (not the package index): the index also pulls the
 * Codex app-server bridge, which needs Node. Codex and Genspark have no web route; a request for
 * them, or for a provider the server table does not list, fails with `credential_missing`.
 *
 * `uniwork` (UniWork AI) is not a BYOK provider: it never goes through the proxy fetch or a vendor
 * protocol. The ai-provider adapter (`streamUniwork`) runs one agent turn per request over the frame
 * transport below (`client.uniworkChat`, the frame route), and its notices / turn reset / failures
 * are mapped to the same chunk sequence the panel already reads.
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
import {
  AiCreditsError,
  type StreamCallbacks,
} from '../../../../packages/ai-provider/src/protocols/shared'
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
import { uniworkConversations } from '../../../../packages/ai-provider/src/uniwork/conversation'
import { streamUniwork } from '../../../../packages/ai-provider/src/uniwork/protocol'
import {
  UNIWORK_PROVIDER_ID,
  UNIWORK_RUN_HEADER,
  type UniworkChatTransport,
  type UniworkScope,
} from '../../../../packages/ai-provider/src/uniwork/types'
import {
  AI_CHAT_RESPONSE_TIMEOUT_MS,
  AiTimeoutError,
  createStreamWatchdog,
} from '../../../../packages/ai-provider/src/watchdog'
import type { AiRunTracker } from '../ai-run'
import type { AiWebClient } from './client'
import {
  AiWebError,
  asUniworkFailure,
  findAiWebError,
  rawFailureAsTyped,
  type UniworkFailure,
} from './errors'
import { createProxyFetch } from './transport'

export type WireProtocol = 'openai-compatible' | 'anthropic' | 'gemini'

/** the tracker as the UniWork AI turn uses it: it may also take the run id the server issued */
export type UniworkRunTracker = AiRunTracker & { setRunId?(runId: string): void }

/** what the UniWork AI branch of aiStream needs from the frame session (absent = no UniWork AI) */
export interface UniworkStreamDeps {
  /** the frame route scope of this document and module; null = UniWork AI is not available here */
  scope(): UniworkScope | null
  /** the cloud tools (search, images, media) are granted: they may go out with the turn */
  cloudTools(): boolean
  /** the localized text of a failed turn (aiErr* / aiUniworkOff) */
  describeFailure(failure: UniworkFailure): string
  /** UniWork AI is off for this organization or format (before any run): hide the entry */
  onOff(): void
  /** test seam: the adapter (default: ai-provider `streamUniwork`) */
  stream?: typeof streamUniwork
}

export interface StreamDeps {
  client: Pick<AiWebClient, 'base' | 'fetch'> & Partial<Pick<AiWebClient, 'uniworkChat'>>
  /** the server's wire protocol of a provider id (from GET credentials `providers`); null = unknown */
  protocolOf(provider: string): WireProtocol | null
  /**
   * the localized text of a typed failure: the panel shows it as the turn's error, and that inline
   * error is the ONE surface of a failed turn (no floating card beside it)
   */
  describe(error: AiWebError, provider: string): string
  /**
   * a one-shot `aiChat` failed with a typed state. Only that path: a chat turn (`aiStream`) has
   * the panel's inline error, a one-shot call (feature actions, hints) may have no surface at all,
   * so the bridge raises its in-frame state card for it.
   */
  onChatFailure?(error: AiWebError, provider: string): void
  /** the frame's AI turn state: a chat stream is a running turn until it ends (X-02 `aiRun`, S6) */
  aiRun?: UniworkRunTracker
  uniwork?: UniworkStreamDeps
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

/** a provider with a key but no model: the server would answer a bare 400, so nothing is sent */
function modelRequired(provider: string): AiWebError {
  return new AiWebError({ code: 'model_required', status: 0, message: provider })
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

  const typed = (err: AiWebError, provider: string): string => deps.describe(err, provider)
  const chatTyped = (err: AiWebError, provider: string): string => {
    deps.onChatFailure?.(err, provider)
    return typed(err, provider)
  }

  /** a UniWork AI turn: the adapter over the frame transport, mapped to the panel's chunks */
  async function uniworkTurn(request: AiStreamRequest): Promise<void> {
    const { requestId, messages } = request
    const uniwork = deps.uniwork
    const chat = deps.client.uniworkChat
    if (request.purpose) {
      // the loop's context summary and the one-shot writers are not the user's question: the
      // server keeps the conversation, so they never go out (the loop folds old turns mechanically)
      const failure: UniworkFailure = { code: 'unsupported' }
      emit({
        requestId,
        type: 'error',
        error: uniwork?.describeFailure(failure) ?? 'UniWork AI does not take this request.',
        uniworkCode: failure.code,
      })
      return
    }
    const scope = uniwork?.scope() ?? null
    if (!uniwork || !chat || !scope) {
      // not available in this frame (grant off, format off): hidden, never an error chip. The turn
      // ends quietly after the note (EXPERIENCE: no error bubble, no Retry for a provider that is gone)
      uniwork?.onOff()
      emit({ requestId, type: 'notice', notice: { kind: 'uniwork-off' } })
      emit({ requestId, type: 'done' })
      return
    }
    const controller = new AbortController()
    active.set(requestId, controller)
    deps.aiRun?.begin(requestId, () => controller.abort())
    const transport: UniworkChatTransport = {
      post: async (req) => {
        const res = await chat({ headers: req.headers, body: req.body, signal: req.signal })
        // the run id of the turn is the one the server issued, as soon as a response carries it
        const runId = res.headers.get(UNIWORK_RUN_HEADER)
        if (runId) deps.aiRun?.setRunId?.(runId)
        return res
      },
    }
    let lastPing = 0
    const ping = (): void => {
      const now = Date.now()
      if (now - lastPing < 5_000) return
      lastPing = now
      emit({ requestId, type: 'ping' })
    }
    let stopReason: string | undefined
    let off = false
    // the adapter sent `uniwork-off` (a 403 before any run id): the note is the whole answer
    let offNoticed = false
    const cb: StreamCallbacks = {
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      signal: controller.signal,
      onDelta: (text) => emit({ requestId, type: 'delta', text }),
      onReasoningDelta: (text) => emit({ requestId, type: 'reasoning', text }),
      onToolCall: (toolCall) => emit({ requestId, type: 'tool-call', toolCall }),
      onActivity: ping,
      onStopReason: (reason) => {
        stopReason = reason
      },
      onNotice: (notice) => {
        if (notice.kind === 'uniwork-off') {
          offNoticed = true
          if (!off) {
            off = true
            uniwork.onOff()
          }
        }
        emit({ requestId, type: 'notice', notice })
      },
      onTurnReset: () => emit({ requestId, type: 'reset' }),
    }
    try {
      await (uniwork.stream ?? streamUniwork)(
        transport,
        {
          scope,
          messages,
          tools: request.tools ?? [],
          toolPolicy: { cloudTools: uniwork.cloudTools() },
        },
        cb,
      )
      emit(
        stopReason === undefined
          ? { requestId, type: 'done' }
          : { requestId, type: 'done', stopReason },
      )
    } catch (err) {
      if (controller.signal.aborted) {
        emit({ requestId, type: 'done' })
        return
      }
      const failure =
        asUniworkFailure(err) ??
        (isAiNetworkError(err)
          ? ({
              code:
                typeof navigator !== 'undefined' && navigator.onLine === false
                  ? 'offline'
                  : 'disconnected',
            } satisfies UniworkFailure)
          : undefined)
      // a lost session may come back as another account: nothing of this one is sent again
      if (failure?.code === 'session_expired') uniworkConversations.clear()
      if (failure?.code === 'office_capability_off' && !off) {
        off = true
        uniwork.onOff()
      }
      if (failure?.code === 'office_capability_off' && offNoticed) {
        // off before a run id: the note was shown, the turn just ends (no error chunk, no Retry)
        emit({ requestId, type: 'done' })
        return
      }
      emit({
        requestId,
        type: 'error',
        error: failure
          ? uniwork.describeFailure(failure)
          : err instanceof Error
            ? err.message
            : String(err),
        ...(failure ? { uniworkCode: failure.code } : {}),
        ...(failure?.retryAfterSec !== undefined ? { retryAfterSec: failure.retryAfterSec } : {}),
      })
    } finally {
      active.delete(requestId)
      deps.aiRun?.end(requestId)
    }
  }

  async function aiStream(request: AiStreamRequest): Promise<void> {
    const { requestId, settings, system, messages } = request
    const provider = settings.provider
    if (provider === UNIWORK_PROVIDER_ID) return uniworkTurn(request)
    // a turn of another provider on this session ends the UniWork AI conversation (the next UniWork
    // turn opens a new one with a boundary notice)
    uniworkConversations.observe(request.sessionId, provider)
    const protocol = deps.protocolOf(provider)
    if (!protocol) {
      emit({ requestId, type: 'error', error: typed(missing(provider), provider) })
      return
    }
    const config = proxyConfig(deps.client, provider, settings)
    if (!config.model.trim()) {
      emit({ requestId, type: 'error', error: typed(modelRequired(provider), provider) })
      return
    }
    installProxyTransport(deps.client)
    const endpoint = resolveWebEndpoint(provider, config, protocol)
    const tools: AgentToolDef[] = request.tools ?? []
    const maxTokens = request.maxTokens ?? maxOutputTokensOf(settings)
    const controller = new AbortController()
    active.set(requestId, controller)
    deps.aiRun?.begin(requestId, () => controller.abort())
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
      const web = findAiWebError(err) ?? (errorCodeOf(err) ? undefined : rawFailureAsTyped(err))
      if (controller.signal.aborted) {
        emit({ requestId, type: 'done' })
      } else if (web) {
        emit({ requestId, type: 'error', error: typed(web, provider) })
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
      deps.aiRun?.end(requestId)
    }
  }

  async function aiChat(request: {
    settings: AiSettings
    system: string
    user: string
  }): Promise<AiChatResponse> {
    const provider = request.settings.provider
    // UniWork AI is one agent turn per request (aiStream): it has no one-shot chat route
    if (provider === UNIWORK_PROVIDER_ID) {
      return {
        ok: false,
        error:
          deps.uniwork?.describeFailure({ code: 'ai_disabled' }) ?? 'UniWork AI is not available',
      }
    }
    const protocol = deps.protocolOf(provider)
    if (!protocol) return { ok: false, error: chatTyped(missing(provider), provider) }
    const config = proxyConfig(deps.client, provider, request.settings)
    if (!config.model.trim())
      return { ok: false, error: chatTyped(modelRequired(provider), provider) }
    installProxyTransport(deps.client)
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
      const web = findAiWebError(err) ?? (errorCodeOf(err) ? undefined : rawFailureAsTyped(err))
      if (web) return { ok: false, error: chatTyped(web, provider) }
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
