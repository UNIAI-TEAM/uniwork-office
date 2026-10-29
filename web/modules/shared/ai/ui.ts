/**
 * In-frame UI of the web AI bridge (CONTRACT C16), plain DOM so every module (React or not) gets
 * the same one: `showAiState()`, the typed failure card (one at a time, `data-ai-state="<code>"`).
 * UniWork AI is the only AI of the frame (UNI-2289): there is no key to fix, so no card offers AI
 * settings; each one only closes.
 * Chrome: the frame dialog buttons (../frame-dialog.css) + ./ai-web.css (theme tokens only).
 * Strings: ../i18n/strings-ai-web.ts in the UI language.
 */
import '../frame-dialog.css'
import './ai-web.css'
import { webLanguage } from '../../../docs/bridge/browser'
import { aiWebText, type AiWebStringKey } from '../i18n/strings-ai-web'
import type { AiWebError, AiWebErrorCode } from './errors'

const t = (key: AiWebStringKey, params?: Record<string, string | number>): string =>
  aiWebText(webLanguage(), key, params)

interface StateText {
  title: AiWebStringKey
  body: AiWebStringKey
  warn?: boolean
}

const STATES: Record<AiWebErrorCode, StateText> = {
  credits_exhausted: { title: 'aiWebStateCreditsTitle', body: 'aiWebStateCreditsBody', warn: true },
  entitlement_required: {
    title: 'aiWebStateEntitlementTitle',
    body: 'aiWebStateEntitlementBody',
    warn: true,
  },
  rate_limited: { title: 'aiWebStateRateTitle', body: 'aiWebStateRateBody' },
  provider_unreachable: { title: 'aiWebStateUnreachableTitle', body: 'aiWebStateUnreachableBody' },
  cloud_unavailable: { title: 'aiWebStateCloudTitle', body: 'aiWebStateCloudBody' },
  cloud_outage: { title: 'aiWebStateOutageTitle', body: 'aiWebStateOutageBody' },
  unauthorized: { title: 'aiWebStateSessionTitle', body: 'aiWebStateSessionBody', warn: true },
  bad_request: { title: 'aiWebStateRefusedTitle', body: 'aiWebStateRefusedBody' },
  unknown: { title: 'aiWebStateUnknownTitle', body: 'aiWebStateUnknownBody' },
}

function stateTexts(err: AiWebError): { title: string; body: string } {
  const s = STATES[err.code]
  const body =
    err.code === 'rate_limited'
      ? err.retryAfterSec
        ? t('aiWebStateRateBody', { seconds: err.retryAfterSec })
        : t('aiWebStateRateBodyNow')
      : t(s.body)
  return { title: t(s.title), body }
}

/** the one-line text of a typed failure (the panel shows it as the turn's error) */
export function describeAiError(err: AiWebError): string {
  const { title, body } = stateTexts(err)
  return `${title}. ${body}`
}

const STATE_MARKER = 'data-ai-state'

export function hideAiState(): void {
  for (const el of document.querySelectorAll(`.ow-ai-state[${STATE_MARKER}]`)) el.remove()
}

/** the typed failure card (replaces the previous one) */
export function showAiState(err: AiWebError): HTMLElement {
  hideAiState()
  const s = STATES[err.code]
  const { title, body } = stateTexts(err)
  const card = document.createElement('div')
  card.className = 'ow-ai-state'
  card.setAttribute(STATE_MARKER, err.code)
  card.setAttribute('role', s.warn ? 'alert' : 'status')
  if (s.warn) card.dataset.tone = 'warn'
  const h = document.createElement('div')
  h.className = 'ow-ai-state-title'
  h.textContent = title
  const p = document.createElement('div')
  p.className = 'ow-ai-state-body'
  p.textContent = body
  const row = document.createElement('div')
  row.className = 'ow-ai-actions'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'ow-dlg-btn primary'
  close.textContent = t('aiWebClose')
  close.addEventListener('click', () => card.remove())
  row.append(close)
  card.append(h, p, row)
  document.body.append(card)
  return card
}
