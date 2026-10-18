import { app, session } from 'electron'

export const SPELLCHECK_DOWNLOAD_BLOCKED_URL = 'file:///nonexistent/'
export const SPELLCHECK_DOWNLOAD_DEFAULT_URL = 'https://redirector.gvt1.com/edgedl/chrome/dict/'

let hostResolverConfigured = false

/**
 * NET-OFF-01: Disable Chromium's built-in DNS-over-HTTPS (secure DNS) probe at
 * startup, immediately after `app.whenReady()` and before any window or session
 * can issue a network request.
 */
export function configureStartupHostResolver(): void {
  if (hostResolverConfigured) return
  hostResolverConfigured = true
  app.configureHostResolver({ secureDnsMode: 'off' })
}

export function resetStartupHostResolverForTest(): void {
  hostResolverConfigured = false
}

/**
 * NET-OFF-01 / NET-OFF-02: Gate Chromium's Hunspell dictionary download URL on
 * whether the user is signed in, and when transitioning into a newly signed-in
 * session (`reload = true`), cycle the selected spellchecker languages through
 * `[]` and back so Chromium rebuilds any dictionary object that failed while
 * signed out.
 */
export function applySpellcheckDictionaryDownloadGate(
  signedIn: boolean,
  reload = false,
  allowedBaseUrl = SPELLCHECK_DOWNLOAD_DEFAULT_URL,
): void {
  try {
    const ses = session.defaultSession
    const url = signedIn ? allowedBaseUrl : SPELLCHECK_DOWNLOAD_BLOCKED_URL
    ses.setSpellCheckerDictionaryDownloadURL(url)
    if (!reload) return
    const langs = ses.getSpellCheckerLanguages()
    if (langs.length === 0) return
    const available = ses.availableSpellCheckerLanguages
    const valid = Array.isArray(available)
      ? langs.filter((l): l is string => typeof l === 'string' && available.includes(l))
      : langs
    if (valid.length === 0) return
    const enabled = ses.isSpellCheckerEnabled()
    ses.setSpellCheckerLanguages([])
    ses.setSpellCheckerLanguages(valid)
    if (!enabled) ses.setSpellCheckerEnabled(false)
  } catch (error) {
    console.warn(
      'uniwork docs: spellcheck dictionary gate failed:',
      error instanceof Error ? error.name : 'unknown',
    )
  }
}
