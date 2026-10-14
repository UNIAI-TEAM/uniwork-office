/** JSON-Schema described tool exposed to the model */
export interface AgentToolDef {
  name: string
  description: string
  /** JSON Schema (object) describing the tool input */
  inputSchema: Record<string, unknown>
}

export interface AgentToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  /** Parse error when the model emitted invalid input JSON; the loop feeds back an is_error result for retry instead of aborting the run */
  inputError?: string | undefined
  /** The argument stream was cut off by the token limit (stop_reason max_tokens); the loop asks the model to split the call instead of "fixing JSON" */
  truncated?: boolean | undefined
  /** Opaque provider token that must travel back with the call in history (Gemini 3 thoughtSignature; a 400 otherwise) */
  signature?: string | undefined
}

export interface AgentToolResult {
  id: string
  /** tool name (Gemini addresses function responses by name, not id) */
  name: string
  output: string
  isError?: boolean | undefined
}

/** inline image attached to a user turn, fed to vision-capable providers as multimodal input */
export interface AgentImage {
  /** raw base64 (no data: URL prefix) */
  base64: string
  /** e.g. "image/png" */
  mime: string
}

/** Token usage one model turn was billed (best-effort: providers that do not
 * report usage simply never fire the callback — absent is "unknown", not zero). */
export interface AgentTokenUsage {
  inputTokens?: number
  outputTokens?: number
}

export type AgentMessage =
  | {
      role: 'user'
      text: string
      images?: AgentImage[] | undefined
      /**
       * the user's own words when `text` also carries the editor context the loop appended
       * (text = instruction + context); a transport with a question cap (UniWork AI) keeps
       * these whole and clips only the context
       */
      instruction?: string | undefined
    }
  /** reasoning: opaque vendor thinking captured during the turn; interleaved-thinking
   * models (MiniMax M3, DeepSeek V4) degrade in tool loops unless it is echoed back */
  | {
      role: 'assistant'
      text: string
      toolCalls?: AgentToolCall[] | undefined
      reasoning?: string | undefined
    }
  | { role: 'tool'; results: AgentToolResult[] }

/**
 * Side-channel display data: UI-only, never merged into messages sent to the LLM.
 * kind='images' → image grid; kind='links' → link list; kind='text' → extra text.
 */
export interface ToolDisplay {
  kind: 'images' | 'links' | 'text'
  /** entry list for images / links modes */
  items?: Array<{ url: string; title?: string; thumb?: string }>
  /** extra text for text mode */
  text?: string
}

/** outcome of one tool execution */
export interface ToolExecution {
  /** result text fed back to the model */
  output: string
  isError?: boolean
  /** true when the tool changed the underlying artifact (document / sheet / deck) */
  mutated?: boolean
  /** short human-readable label for activity UI */
  summary: string
  /**
   * Side-channel display: for UI only, never enters the LLM context.
   * Ignored when tool results are assembled into an AgentMessage.
   */
  display?: ToolDisplay
}

// ---- run phase (drives the in-progress status line in chat UIs) ----

export type AgentPhaseKind =
  /** request sent, waiting for the model's first content block */
  | 'requesting'
  | 'thinking'
  | 'responding'
  /** the model is streaming tool arguments (e.g. a full outline) with no visible text */
  | 'tool-input'
  | 'tool-running'

export interface AgentPhase {
  kind: AgentPhaseKind
  toolName?: string | undefined
}

// ---- LLM transport (how one model turn is streamed; app supplies the impl) ----

/**
 * What a request is for. Absent = an agent turn of the loop. `summary` (the
 * loop's context compaction) and `one-shot` (streamText writers) are not the
 * user's question: a transport whose server keeps the conversation (UniWork
 * AI) refuses them instead of sending them as one.
 */
export type AgentRequestPurpose = 'summary' | 'one-shot'

export interface AgentStreamRequest {
  system: string
  messages: AgentMessage[]
  tools: AgentToolDef[]
  purpose?: AgentRequestPurpose | undefined
}

export interface AgentStreamCallbacks {
  onDelta(text: string): void
  /** raw model reasoning delta; the loop stores it on the assistant message for interleaved-thinking echo */
  onReasoning?(text: string): void
  /** complete parsed tool call (arguments finished streaming) */
  onToolCall(call: AgentToolCall): void
  /** Phase changes within the model stream (thinking / responding / tool-input); older transports may omit this */
  onPhase?(phase: AgentPhase): void
  /** normalized stop reason of the turn ('max_tokens' = cut off by the token limit); transports may omit this */
  onStopReason?(reason: string): void
  /** a non-fatal turn notice (UniWork AI: dropped tool calls, a Retry-After wait, a new conversation); transports may omit this */
  onNotice?(notice: AgentStreamNotice): void
  /**
   * the transport restarts the same turn (UniWork AI resends after a Retry-After wait): drop this
   * turn's streamed text, reasoning and tool calls; history is untouched. Transports may omit this.
   */
  onTurnReset?(): void
  /** tokens the provider billed for this turn; transports whose provider does not report usage omit this */
  onUsage?(usage: AgentTokenUsage): void
  onDone(): void
  onError(error: string): void
}

/** a tool call the UniWork AI server refused to hand to the client (`x_uniwork.dropped_tool_calls[]`) */
export interface AgentDroppedToolCall {
  index: number
  name: string
  reason: 'view_only' | 'not_allowlisted'
}

/**
 * Non-fatal information a transport reports during a turn. Only the UniWork AI adapter sends
 * these today; a consumer ignores a kind it does not know.
 * - `dropped-tool-calls`: calls the server filtered out of this answer, with their reason
 * - `step`: tool rounds used by the run after this answer, and the cap
 * - `rate-limit-wait`: the transport waits `seconds` before resending (attempt 1..3); no retry button
 * - `conversation-restarted`: the server conversation expired; the question was not sent
 * - `conversation-boundary`: this turn starts a new server conversation after a provider switch
 * - `uniwork-off`: UniWork AI is off for this organization or format (hide it, no error chip)
 * - `images-not-sent`: the question's images were left out (UniWork AI takes text only)
 */
export type AgentStreamNotice =
  | { kind: 'dropped-tool-calls'; calls: AgentDroppedToolCall[] }
  | { kind: 'step'; step: number; limit: number }
  | { kind: 'rate-limit-wait'; seconds: number; attempt: number }
  | { kind: 'conversation-restarted' }
  | { kind: 'conversation-boundary'; provider: string }
  | { kind: 'uniwork-off' }
  | { kind: 'images-not-sent' }

export interface AgentStreamHandle {
  /** abort the in-flight turn; the transport must still emit onDone afterwards */
  cancel(): void
}

export interface AgentTransport {
  stream(request: AgentStreamRequest, callbacks: AgentStreamCallbacks): AgentStreamHandle
}
