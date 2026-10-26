import { createIpcTransport, type AgentTransport } from '@genoffice/agent-core'
import type { AiSettings } from '@genoffice/ai-provider'
import { aiUniworkText, type AiUniworkStringKey } from '@genoffice/ui'
import { uniworkErrorKey } from '@genoffice/ai-provider/browser'
import { getLang, t } from '../i18n/locale'

/** The shared IPC transport wired to the sheets preload bridge (window.desktopApi). */
export function createElectronTransport(getSettings: () => AiSettings): AgentTransport {
  return createIpcTransport<AiSettings>({
    onStream: (listener) => window.desktopApi.onAiStream(listener),
    start: (request) => window.desktopApi.aiStream(request),
    cancel: (requestId) => void window.desktopApi.aiStreamCancel(requestId),
    getSettings,
    unknownErrorText: () => t('aiUnknownError'),
    timeoutErrorText: () => t('aiTimeoutError'),
    creditsErrorText: () => t('aiCreditsExhausted'),
    networkErrorText: () => t('aiNetworkError'),
    overloadedErrorText: () => t('aiOverloadedError'),
<<<<<<< ours
    // a UniWork AI failure is worded by its code (S9), in the UI language, never by the chunk's text
    uniworkError: (code, retryAfterSec) => {
      const errorKey = uniworkErrorKey(code, 'desktop') as AiUniworkStringKey
      return {
        text: aiUniworkText(getLang(), errorKey, { seconds: retryAfterSec ?? 0 }),
        errorKey,
      }
    },
=======
    regionErrorText: () => t('aiRegionError'),
>>>>>>> theirs
  })
}
