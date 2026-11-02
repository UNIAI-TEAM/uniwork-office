import type {
  AgentMessage,
  AgentRequestPurpose,
  AgentStreamNotice,
  AgentToolCall,
  AgentToolDef,
  WriterCall,
} from '@genoffice/agent-core'

/** UniWork AI: the organization's server-side model through the UniWork façade (no key) */
export type AiProviderId = 'uniwork'

/** UniWork cloud account status (internal name kept): loggedIn = signed in to UniWork + plan includes cloud AI */
export interface GenSparkAccountStatus {
  loggedIn: boolean
  email?: string
}

export interface AiSettings {
  provider: AiProviderId
  /** no provider slots: UniWork AI has no key and the server picks the model */
  providers: Record<string, never>
  /**
   * UniWork cloud tools (web/image search, image generation, media
   * analysis). Default true; false makes the tools unavailable. Only
   * meaningful while signed in + entitled (see uniwork-cloud.ts).
   */
  gskToolsEnabled?: boolean
  /** the model UniWork AI serves (server policy); '' or absent = unknown, the row shows its label. Derived, never saved */
  uniworkModel?: string | undefined
}

export interface AiStreamRequest {
  requestId: string
  /** Stable renderer transport id: keys the UniWork AI conversation and run ids (uniwork/conversation.ts). */
  sessionId?: string
  settings: AiSettings
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
  /**
   * not an agent turn: the loop's context summary or a one-shot writer. UniWork AI refuses both,
   * except a one-shot that names its `writer`, which the web frame sends to the writer route
   */
  purpose?: AgentRequestPurpose
  /** the one-shot as a UniWork AI writer (kind + input) */
  writer?: WriterCall
}

/** Token usage a provider reported for one model turn. Both fields are best-effort:
 * some providers never report usage, and consumers must
 * treat an absent figure as "unknown", never as zero. */
export interface AiTokenUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface AiStreamChunk {
  requestId: string
  /** 'ping' = wire-level keepalive so the renderer can tell a live stream from a dead one;
   * 'reasoning' = model thinking delta (text carries it), stored for interleaved-thinking echo */
  type:
    'delta' | 'reasoning' | 'tool-call' | 'usage' | 'done' | 'error' | 'ping' | 'notice' | 'reset'
  text?: string
  /** complete parsed tool call (emitted once its arguments finish streaming) */
  toolCall?: AgentToolCall
  /** 'notice' only: a non-fatal turn notice (UniWork AI); 'reset' = drop this turn's streamed output, the same turn is resent */
  notice?: AgentStreamNotice
  error?: string
  /** machine-readable error cause ('timeout', 'network' connectivity failure, 'overloaded' capacity/rate limit); lets the renderer localize the message */
  errorCode?: 'timeout' | 'network' | 'overloaded'
  /** a UniWork AI failure: the server's `code` (UniworkWireCode) decides the message, never the text or errorCode */
  uniworkCode?: string
  /** with uniworkCode: seconds the server asked to wait (Retry-After), when it sent one */
  retryAfterSec?: number
  /** normalized stop reason carried on 'done' ('max_tokens' = output cut off by the token limit) */
  stopReason?: string
  /** the server's run id of this turn (UniWork AI `X-UniWork-AI-Run`), on the chunk after it is known */
  runId?: string
  /** tokens the provider billed for this turn, carried on 'usage' (always sent before 'done') */
  usage?: AiTokenUsage
}
