/**
 * The text a failed save shows in a module's status bar and toast. The protocol's own message is
 * developer English ("Failed to fetch", "save timed out", the host's raw status line "Internal
 * Server Error"), so no failure shows it: a network or timeout failure gets the module's translated
 * sentence, every other one the shared sentence of its protocol code / HTTP status (./i18n/web).
 */
import { webLanguage } from '../../docs/bridge/browser'
import { webText, type WebStringKey } from './i18n/strings-web'

interface SaveError {
  code: string
  message: string
  /** the HTTP status the host reported, when it did */
  status?: number
}

/** the shared sentence of a save failure that came back with a status (never network / timeout) */
export function saveFailureKey(error: SaveError): WebStringKey {
  const status = error.status ?? 0
  if (error.code === 'unauthorized') return 'webSaveUnauthorized'
  if (error.code === 'forbidden') return 'webSaveForbidden'
  if (error.code === 'not_found' || status === 404 || status === 410) return 'webSaveNotFound'
  if (error.code === 'too_large') return 'webSaveTooLarge'
  if (error.code === 'rate_limited') return 'webSaveRateLimited'
  if (status >= 500) return 'webSaveServer'
  return 'webSaveFailedGeneric'
}

/** the localized sentence of a status failure; null for a transport failure (timeout, network) */
export function saveFailureDetail(error: SaveError): string | null {
  if (error.code === 'timeout' || error.code === 'network') return null
  return webText(webLanguage(), saveFailureKey(error))
}

export function saveFailureText(
  error: SaveError,
  translate: (key: 'webSaveNetwork' | 'webSaveTimeout') => string,
): string {
  if (error.code === 'timeout') return translate('webSaveTimeout')
  if (error.code === 'network') return translate('webSaveNetwork')
  return webText(webLanguage(), saveFailureKey(error))
}
