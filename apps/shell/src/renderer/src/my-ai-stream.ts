/**
 * Streaming My AI replies over the same IPC transport as editor AI panels.
 */
import { createIpcTransport, type AgentImage } from '@genoffice/agent-core'
import { aiChatFailureText, type AiSettings } from '@genoffice/ai-provider/browser'

export interface StreamMyAiOptions {
  system: string
  user: string
  images?: AgentImage[]
  settings: AiSettings
  /** UI language of the failure messages (vi or en; any other reads English) */
  lang?: string
  maxChars?: number
  onDelta: (cumulative: string) => void
  /** Called with a cancel function once the stream starts */
  onReady?: (cancel: () => void) => void
}

export interface StreamMyAiResult {
  ok: boolean
  content?: string
  error?: string
  cancelled?: boolean
}

export function createMyAiTransport(getSettings: () => AiSettings, lang = 'en') {
  return createIpcTransport<AiSettings>({
    onStream: (listener) => window.aiOffice.onAiStream(listener),
    start: (request) => window.aiOffice.aiStream(request),
    cancel: (requestId) => void window.aiOffice.aiStreamCancel(requestId),
    getSettings,
    unknownErrorText: () => aiChatFailureText('failed', lang),
    timeoutErrorText: () => aiChatFailureText('network', lang),
    creditsErrorText: () => aiChatFailureText('limit', lang),
    networkErrorText: () => aiChatFailureText('network', lang),
    overloadedErrorText: () => aiChatFailureText('unavailable', lang),
  })
}

/** Tool-less streaming turn; resolves with cumulative text (never throws). */
export function streamMyAiReply(opts: StreamMyAiOptions): Promise<StreamMyAiResult> {
  const maxChars = opts.maxChars ?? 12_000
  const transport = createMyAiTransport(() => opts.settings, opts.lang)
  return new Promise((resolve) => {
    let raw = ''
    let settled = false
    const finish = (result: StreamMyAiResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const handle = transport.stream(
      {
        system: opts.system,
        messages: [
          {
            role: 'user',
            text: opts.user,
            ...(opts.images && opts.images.length > 0 ? { images: opts.images } : {}),
          },
        ],
        tools: [],
      },
      {
        onDelta: (delta) => {
          if (settled) return
          raw += delta
          opts.onDelta(raw)
          if (raw.length > maxChars) {
            handle.cancel()
            finish({
              ok: true,
              content: raw.slice(0, maxChars),
              error: `output truncated at ${maxChars} chars`,
            })
          }
        },
        onToolCall: () => undefined,
        onDone: () => {
          if (settled) return
          const content = raw.trim()
          if (!content) finish({ ok: false, error: 'empty reply' })
          else finish({ ok: true, content })
        },
        onError: (error) => {
          if (settled) return
          if (raw.trim()) finish({ ok: true, content: raw.trim(), error })
          else finish({ ok: false, error })
        },
      },
    )
    opts.onReady?.(() => {
      handle.cancel()
      finish({
        ok: Boolean(raw.trim()),
        content: raw.trim() || undefined,
        cancelled: true,
        error: 'cancelled',
      })
    })
  })
}
