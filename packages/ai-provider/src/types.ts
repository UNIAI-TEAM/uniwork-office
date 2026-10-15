import type {
  AgentMessage,
  AgentRequestPurpose,
  AgentStreamNotice,
  AgentToolCall,
  AgentToolDef,
} from '@genoffice/agent-core'

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
  /** UniWork AI: the organization's server-side model through the UniWork façade (no key, never BYOK pass-through) */
  | 'uniwork'

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

/** where one provider's chip rows come from (G6-05m): Settings first, the live list, the catalog as fallback */
export interface AiModelSource {
  /** the model chosen for this provider in Settings (server row on web, ai-settings.json on desktop); '' = none */
  readonly chosen: string
  /** the provider's live model ids from its own /models; absent = not listed (yet), the catalog is shown */
  readonly listed?: readonly string[] | undefined
  /** 'loading' while a first listing runs, 'error' after a failed one (the catalog is shown); absent = ok or not asked */
  readonly listState?: 'loading' | 'error' | undefined
  /** where calls for this provider go (G6-05k). Absent or 'local' = the key on this machine (or the
   *  web host's own rows); 'org' = the key saved on UniWork, through the UniWork proxy. Derived, never saved. */
  readonly origin?: 'local' | 'org' | undefined
}

/** the model the user picked for one provider (chip or Settings), sent beside `ai:set-settings` */
export interface AiModelPick {
  readonly provider: AiProviderId
  readonly model: string
}

/**
 * What a renderer may say beside the settings it saves (`ai:set-settings` second argument).
 * `modelPick` is the one signal that a model was chosen: a plain echo of the loaded settings
 * carries none, so a provider served by a key saved on UniWork records no pick from it.
 */
export interface AiSettingsSaveOptions {
  readonly modelPick?: AiModelPick | undefined
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
   * false = this host runs only the viewer's own providers, so the UniAI pool (`genspark`) is not
   * offered in the model picker even while the cloud sign-in is reported (the web frames).
   * Absent means offered.
   */
  uniAiAvailable?: boolean
  /**
   * true = the host could not read which keys are stored (a network or sign-in failure on the
   * list). Nothing is known about the keys, so the model chip must not claim "no key" and send
   * stays available (the server decides); the next read retries. Absent means the keys are known.
   */
  credentialsUnavailable?: boolean
  /**
   * Per provider: the model chosen in Settings and the provider's live model list (G6-05m).
   * Derived by the host on every read and never saved: a host writing settings back drops it.
   * A provider without an entry (older host or server) gets the hard-coded catalog.
   */
  modelSources?: Partial<Record<AiProviderId, AiModelSource>> | undefined
  /** the model UniWork AI serves (server policy); '' or absent = unknown, the row shows its label. Derived, never saved */
  uniworkModel?: string | undefined
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
  /** not an agent turn: the loop's context summary or a one-shot writer (UniWork AI refuses both) */
  purpose?: AgentRequestPurpose
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
  /** machine-readable error cause ('timeout', exhausted 'credits', 'network' connectivity failure, 'overloaded' capacity/rate limit); lets the renderer localize the message */
  errorCode?: 'timeout' | 'credits' | 'network' | 'overloaded'
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
