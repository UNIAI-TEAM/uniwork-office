/**
 * AI / search / image bridge, web build (UNI-1013 W4).
 *
 * AI on the web is out of scope for this lane (needs ADR GO-C2): every entry is
 * hidden by the `ai` / `webSearch` / `imageSearch` / `imageGeneration` /
 * `createDocument` / `billing` capabilities (see ./hide.ts `webCapabilities`),
 * and this module is the safety net behind it. Nothing here talks to a model or
 * to the network: each call that would need one answers with a typed
 * "unavailable" result and never throws, so a stray caller (an old saved
 * preset, a future entry that forgot its capability check) fails visibly
 * instead of pretending to work.
 *
 * The "unavailable" shape, per method (each fits the DesktopApi return type):
 *
 * | method                      | answer                                              |
 * |-----------------------------|-----------------------------------------------------|
 * | aiChat                      | { ok: false, error }                                |
 * | aiStream                    | one terminal { type: 'error', error } chunk         |
 * | webSearch / imageSearch     | { method: 'error', error, results|images: [] }      |
 * | aiGenerateImage             | { error }                                           |
 * | fetchImage                  | null (cross-origin fetch is not possible in a page) |
 * | aiGskStatus                 | { loggedIn: false }                                 |
 * | aiGskLogin / aiOpenBilling  | no-op                                               |
 * | getAiSettings               | empty provider config, Genspark tools off           |
 * | setAiSettings               | accepted and dropped (nothing is persisted)         |
 *
 * `error` is always `ai-unavailable: <feature> is not available in the web build`
 * (see `aiUnavailableMessage`), so a caller can match on the `ai-unavailable`
 * prefix; `isAiUnavailable` does that.
 */
import { AI_PROVIDERS } from '../../../apps/docs/src/shared/ipc'
import type {
  AiChatResponse,
  AiSettings,
  AiStreamChunk,
  DesktopApi,
} from '../../../apps/docs/src/shared/ipc'

/** machine-readable prefix of every "unavailable" error string */
export const AI_UNAVAILABLE_CODE = 'ai-unavailable'

export function aiUnavailableMessage(feature: string): string {
  return `${AI_UNAVAILABLE_CODE}: ${feature} is not available in the web build`
}

/** true when an error string came from this module's "unavailable" answers */
export function isAiUnavailable(error: string | undefined | null): boolean {
  return typeof error === 'string' && error.startsWith(`${AI_UNAVAILABLE_CODE}:`)
}

const listeners = new Set<(chunk: AiStreamChunk) => void>()

function emit(chunk: AiStreamChunk): void {
  for (const listener of [...listeners]) {
    try {
      listener(chunk)
    } catch (err) {
      console.error('[web-bridge] onAiStream listener threw', err)
    }
  }
}

/** a valid, empty settings object: the renderer reads it at startup even with the AI UI hidden */
function emptySettings(): AiSettings {
  const providers = {} as AiSettings['providers']
  for (const meta of AI_PROVIDERS) {
    providers[meta.id] = {
      apiKey: '',
      model: meta.defaultModel,
      baseUrl: meta.needsBaseUrl ? '' : undefined,
      cliPath: meta.needsCliPath ? '' : undefined,
    }
  }
  return { provider: 'genspark', providers, gskToolsEnabled: false }
}

export default {
  getAiSettings: async () => emptySettings(),
  setAiSettings: async () => {},
  getAiPanelPrefs: async () => ({ fontSize: 'default', customFontSize: 14, spellcheck: true }),

  aiChat: async (): Promise<AiChatResponse> => ({
    ok: false,
    error: aiUnavailableMessage('AI chat'),
  }),

  // resolves after the one terminal chunk, like a real turn that failed to start
  aiStream: async ({ requestId }) => {
    emit({ requestId, type: 'error', error: aiUnavailableMessage('AI assistant') })
  },
  aiStreamCancel: async () => {},
  onAiStream: (handler) => {
    listeners.add(handler)
    return () => {
      listeners.delete(handler)
    }
  },

  aiGskStatus: async () => ({ loggedIn: false }),
  aiGskLogin: async () => {},
  aiOpenBilling: async () => {},

  webSearch: async () => ({
    results: [],
    method: 'error',
    error: aiUnavailableMessage('web search'),
  }),
  imageSearch: async () => ({
    images: [],
    method: 'error',
    error: aiUnavailableMessage('image search'),
  }),
  // The renderer calls this to download an <img src> pasted from another site; a
  // page cannot fetch cross-origin, and null is the documented "could not fetch"
  // answer (the paste then inserts nothing instead of a placeholder).
  fetchImage: async () => null,
  aiGenerateImage: async () => ({ error: aiUnavailableMessage('image generation') }),
} satisfies Partial<DesktopApi>
