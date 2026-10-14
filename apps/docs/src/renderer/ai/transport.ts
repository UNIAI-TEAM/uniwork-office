import { createIpcTransport, type AgentTransport } from '@genoffice/agent-core'
import type { AiSettings } from '../../shared/ipc'
import { aiUniworkText, type AiUniworkStringKey } from '@genoffice/ui'
import { uniworkErrorKey } from '@genoffice/ai-provider/browser'
import { getLang, t } from '../i18n/locale'

/** The shared IPC transport wired to the docs preload bridge (window.desktop). */
export function createElectronTransport(getSettings: () => AiSettings): AgentTransport {
  return createIpcTransport<AiSettings>({
    onStream: (listener) => window.desktop.onAiStream(listener),
    start: (request) => window.desktop.aiStream(request),
    cancel: (requestId) => void window.desktop.aiStreamCancel(requestId),
    getSettings,
    unknownErrorText: () => t('aiUnknownError'),
    timeoutErrorText: () => t('aiTimeoutError'),
    creditsErrorText: () => t('aiCreditsExhausted'),
    networkErrorText: () => t('aiNetworkError'),
    overloadedErrorText: () => t('aiOverloadedError'),
    // a UniWork AI failure is worded by its code (S9), in the UI language, never by the chunk's text
    uniworkErrorText: (code, retryAfterSec) =>
      aiUniworkText(getLang(), uniworkErrorKey(code, 'desktop') as AiUniworkStringKey, {
        seconds: retryAfterSec ?? 0,
      }),
  })
}
