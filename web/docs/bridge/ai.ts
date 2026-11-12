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
 * | aiStream                    | one terminal { type: 'error', error } chunk         |
 * | webSearch / imageSearch     | { method: 'error', error, results|images: [] }      |
 * | aiGenerateImage             | { error }                                           |
 * | fetchImage                  | null (cross-origin fetch is not possible in a page) |
 * | aiGskStatus                 | { loggedIn: false }                                 |
 * | getAiSettings               | UniWork AI, cloud tools off                         |
 * | setAiSettings               | accepted and dropped (nothing is persisted)         |
 *
 * `error` is always `ai-unavailable: <feature> is not available in the web build`
 * (see `aiUnavailableMessage`), so a caller can match on the `ai-unavailable`
 * prefix; `isAiUnavailable` does that.
 */
import type { AiSettings, AiStreamChunk, DesktopApi } from '../../../apps/docs/src/shared/ipc'

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

/** UniWork AI with the cloud tools off: the renderer reads settings at startup even with the AI UI hidden */
function uniworkSettingsToolsOff(): AiSettings {
  return { provider: 'uniwork', providers: {}, gskToolsEnabled: false }
}

export default {
  getAiSettings: async () => uniworkSettingsToolsOff(),
  setAiSettings: async () => {},
  getAiPanelPrefs: async () => ({
    side: 'left',
    fontSize: 'default',
    customFontSize: 14,
    spellcheck: true,
    openInNewDocs: true,
    // the web frame has no AI sidebar to hide; keep the shipped default
    showAiSidebar: true,
    showAiAskTrigger: true,
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
