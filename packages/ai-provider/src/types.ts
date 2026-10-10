import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'

export type AiProviderId =
  | 'genspark'
  | 'codex'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'openai'
  | 'kimi'
  | 'glm'
  | 'qwen'
  | 'doubao'
  | 'mimo'
  | 'hunyuan'
  | 'ling'
  | 'spark'
  | 'longcat'
  | 'minimax'
  | 'xai'
  | 'mistral'
  | 'openrouter'
  | 'requesty'
  | 'opper'
  | 'cheaperinference'
  | 'opencode-zen'
  | 'opencode-go'
  | 'custom'

/** UniWork cloud account status (internal name kept): loggedIn = signed in to UniWork + plan includes cloud AI */
export interface GenSparkAccountStatus {
  loggedIn: boolean
  email?: string
}

export interface AiProviderConfig {
  apiKey: string
  model: string
  /** required for custom; for other direct providers it overrides the default endpoint (regional mirrors) */
  baseUrl?: string | undefined
  /** optional Codex CLI override; empty means auto-detect the current authenticated install */
  cliPath?: string | undefined
}

/** Live picker data returned by Codex app-server's model/list method. */
export interface CodexModelCatalog {
  models: string[]
  defaultModel: string
}

export interface AiProviderMeta {
  id: AiProviderId
  label: string
  models: string[]
  defaultModel: string
  keyPlaceholder: string
  needsBaseUrl?: boolean
  needsCliPath?: boolean
}

/** Image generation / media analysis backends (separate from the chat provider) */
export type AiMediaProviderId =
  | 'genspark'
  | 'openai'
  | 'gemini'
  | 'doubao'
  | 'glm'
  | 'xai'
  | 'qwen'
  | 'minimax'
  | 'deepseek'
  | 'custom'

/** wire shape of the image endpoint */
export type AiImageProtocol = 'openai-images' | 'gemini' | 'dashscope' | 'minimax'
/** wire shape of the understanding endpoint */
export type AiAnalysisProtocol = 'openai-chat' | 'gemini'

export interface AiMediaProviderConfig {
  apiKey: string
  /** required for custom; for the others it overrides the official endpoint (regional mirrors) */
  baseUrl?: string | undefined
  /** image generation model (empty = the provider default) */
  imageModel: string
  /** image/video understanding model (empty = the provider default) */
  analysisModel: string
}

export interface AiMediaProviderMeta {
  id: AiMediaProviderId
  label: string
  /** one-line English blurb shown on the provider card */
  description: string
  keyPlaceholder: string
  needsBaseUrl?: boolean
  /** '' for genspark (UniWork cloud, kept for stored settings) and custom (user-supplied) */
  defaultBaseUrl: string
  /** absent = the provider does not generate images */
  imageProtocol?: AiImageProtocol
  imageModels: string[]
  defaultImageModel: string
  /** absent = the provider does not analyze media */
  analysisProtocol?: AiAnalysisProtocol
  analysisModels: string[]
  defaultAnalysisModel: string
  /** the analysis model accepts video input (Gemini natively; OpenAI-compatible vendors via a video_url part) */
  videoAnalysis: boolean
}

export interface AiMediaSettings {
  /** provider behind generate_image */
  imageProvider: AiMediaProviderId
  /** provider behind analyze_media for images */
  analysisProvider: AiMediaProviderId
  /** provider behind analyze_media when the input has video/audio (only video-capable vendors qualify) */
  videoAnalysisProvider: AiMediaProviderId
  providers: Record<AiMediaProviderId, AiMediaProviderConfig>
  /**
   * Capabilities where the user picked the UniWork cloud entry themselves. A
   * stored `genspark` without this mark is only the default and yields to a
   * BYOK vendor with a usable config.
   */
  cloudPicked?: { image?: boolean; analysis?: boolean; video?: boolean } | undefined
  /** pre-catalog shape (one provider for both); migrated by resolveAiMediaSettings */
  provider?: AiMediaProviderId | undefined
}

/** web/image search backends; `auto` is the keyless chain, Parallel supports both a user key and free keyless search */
export type AiSearchProviderId =
  'auto' | 'serper' | 'serply' | 'tavily' | 'parallel' | 'exa' | 'firecrawl'

export interface AiSearchProviderMeta {
  id: AiSearchProviderId
  label: string
  keyPlaceholder: string
  /** the backend also serves image search (otherwise image search falls back to free sources) */
  imageSearch: boolean
}

export interface AiSearchSettings {
  provider: AiSearchProviderId
  providers: Record<Exclude<AiSearchProviderId, 'auto'>, { apiKey: string }>
}

export interface AiSettings {
  provider: AiProviderId
  providers: Record<AiProviderId, AiProviderConfig>
  /**
   * Provider for generate_image / analyze_media. Absent (pre-media settings
   * files) means the UniWork cloud route, i.e. signed in + entitled + the gskToolsEnabled gate.
   */
  media?: AiMediaSettings | undefined
  /** web/image search backend; absent means `auto` (the keyless free chain) */
  search?: AiSearchSettings | undefined
  /**
   * UniWork cloud tools (web/image search, image generation, media
   * analysis). Default true; false makes tools skip the cloud backend entirely
   * (search falls back to free sources, cloud-only tools are unavailable).
   * Only meaningful while signed in + entitled (see uniwork-cloud.ts).
   */
  gskToolsEnabled?: boolean
  /**
   * Output-token cap for ONE model turn of agent runs (default
   * DEFAULT_MAX_OUTPUT_TOKENS). Reasoning models bill their thinking against
   * this same budget, so a heavy edit turn can consume all of it and close with
   * finish_reason=length and no prose at all — raising it is the user's lever
   * (absent = the default, so pre-existing settings files keep working).
   */
  maxOutputTokens?: number | undefined
}

/** pre-provider settings shape (single OpenAI-compatible endpoint); migrated into "custom" */
export interface LegacyAiSettings {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export interface AiChatRequest {
  settings: AiSettings
  system: string
  user: string
}

export interface AiChatResponse {
  ok: boolean
  content?: string
  error?: string
  /** Same codes as stream errors — e.g. OpenRouter HTTP 402 */
  errorCode?: 'timeout' | 'credits' | 'network' | 'overloaded'
}

export interface AiStreamRequest {
  requestId: string
  /** Stable renderer transport id used to retain native provider sessions. */
  sessionId?: string
  settings: AiSettings
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
}

export interface AiStreamChunk {
  requestId: string
  /** 'ping' = wire-level keepalive so the renderer can tell a live stream from a dead one;
   * 'reasoning' = model thinking delta (text carries it), stored for interleaved-thinking echo */
  type: 'delta' | 'reasoning' | 'tool-call' | 'done' | 'error' | 'ping'
  text?: string
  /** complete parsed tool call (emitted once its arguments finish streaming) */
  toolCall?: AgentToolCall
  error?: string
  /** machine-readable error cause ('timeout', exhausted 'credits', 'network' connectivity failure, 'overloaded' capacity/rate limit); lets the renderer localize the message */
  errorCode?: 'timeout' | 'credits' | 'network' | 'overloaded'
  /** normalized stop reason carried on 'done' ('max_tokens' = output cut off by the token limit) */
  stopReason?: string
}
