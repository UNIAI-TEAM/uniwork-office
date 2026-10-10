import { aiStreamErrorFields } from './ai-chat-error'
import { streamForProvider } from './stream'
import type { AiChatResponse, AiProviderConfig, AiProviderId } from './types'

/** a silent provider fails the Settings test after this long instead of the 3 minute chat idle budget */
export const AI_CHAT_TEST_TIMEOUT_MS = 45_000

/** room for a reasoning model to think before its first visible word; the test stops at the first sign of life */
const AI_CHAT_TEST_MAX_TOKENS = 256

/**
 * The Settings > AI Model "Test": one streamed turn through `streamForProvider`,
 * the exact endpoint, wire format and headers the chat panel uses. A one-shot
 * non-streaming request can fail on a provider (an OpenAI-compatible gateway
 * on a different wire) that chat itself works with, so it is not a fair test.
 * The turn counts as passed at the first answer (text, thinking or a tool
 * call) and is cancelled there to save tokens.
 */
export async function testChatConnection(
  provider: AiProviderId,
  config: AiProviderConfig,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AiChatResponse> {
  const controller = new AbortController()
  let answered = false
  let timedOut = false
  const onParentAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? AI_CHAT_TEST_TIMEOUT_MS)
  const answer = () => {
    answered = true
    controller.abort()
  }
  try {
    await streamForProvider(
      provider,
      config,
      'You are a connectivity test. Reply with the single word OK.',
      [{ role: 'user', text: 'ping' }],
      [],
      AI_CHAT_TEST_MAX_TOKENS,
      {
        signal: controller.signal,
        onDelta: answer,
        onReasoningDelta: answer,
        onToolCall: answer,
      },
    )
    return { ok: true }
  } catch (err) {
    if (answered) return { ok: true }
    if (timedOut) {
      return {
        ok: false,
        error: 'AI test timed out: no answer from the provider',
        errorCode: 'timeout',
      }
    }
    const { raw, errorCode } = aiStreamErrorFields(err, 'en')
    return { ok: false, error: raw, ...(errorCode ? { errorCode } : {}) }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onParentAbort)
  }
}
