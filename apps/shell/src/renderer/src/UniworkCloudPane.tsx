import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  UniworkCloudCredits,
  UniworkCloudState,
  UniworkCloudStatus,
} from '@genoffice/ai-provider/browser'
import { useI18n } from './locale'
import type { StringKey, TFunc } from './locale'

/**
 * UniWork cloud AI in Settings: the status/credits rows under the account
 * (signed in only) and the notice at the top of AI media. The status comes
 * from the shell main process (token-free); this file only renders it.
 */

/** short state label for the Account rows */
export const CLOUD_STATE_KEYS: Record<Exclude<UniworkCloudState, 'signed-out'>, StringKey> = {
  ready: 'cloudStateReady',
  'not-entitled': 'cloudStateNotEntitled',
  'subscription-inactive': 'cloudStateInactive',
  'credits-exhausted': 'cloudStateExhausted',
  unavailable: 'cloudStateUnavailable',
}

export interface CloudNotice {
  tone: 'info' | 'warn'
  title: StringKey
  body: StringKey
  /** show the Sign in action */
  signIn?: boolean
}

/**
 * The AI media notice for one cloud state. `toolsEnabled` is the AI model
 * switch: with it off a ready cloud is only available, not in use.
 */
export function cloudNoticeFor(state: UniworkCloudState, toolsEnabled = true): CloudNotice {
  switch (state) {
    case 'signed-out':
      return { tone: 'info', title: 'cloudTitle', body: 'cloudSignedOutBody', signIn: true }
    case 'not-entitled':
      return { tone: 'info', title: 'cloudStateNotEntitled', body: 'cloudNotEntitledBody' }
    case 'subscription-inactive':
      return { tone: 'warn', title: 'cloudStateInactive', body: 'cloudInactiveBody' }
    case 'credits-exhausted':
      return { tone: 'warn', title: 'cloudStateExhausted', body: 'cloudExhaustedBody' }
    case 'unavailable':
      // the product name leads: the body says what is unavailable
      return { tone: 'warn', title: 'cloudTitle', body: 'cloudUnavailableBody' }
    case 'ready':
      return {
        tone: 'info',
        title: 'cloudTitle',
        body: toolsEnabled ? 'cloudReadyBody' : 'cloudToolsOffBody',
      }
  }
}

/**
 * The verdict of the settings "Test connection" for the blocks that run on the
 * UniWork cloud: the status the server just answered, in the same short labels as
 * the Account rows. A signed-out session never offers the cloud, so it passes.
 */
export function cloudTestVerdict(
  status: UniworkCloudStatus | null,
  t: TFunc,
): { ok: boolean; error?: string } {
  if (!status || status.state === 'ready' || status.state === 'signed-out') return { ok: true }
  return { ok: false, error: t(CLOUD_STATE_KEYS[status.state]) }
}

/** "remaining / limit left", "Unlimited", or null when the server sent no credits */
export function creditsText(
  credits: UniworkCloudCredits | null,
  t: TFunc,
  locale: string,
): string | null {
  if (!credits) return null
  if (credits.limit === null) return t('cloudCreditsUnlimited')
  const fmt = new Intl.NumberFormat(locale)
  const remaining = credits.remaining ?? Math.max(0, credits.limit - credits.used)
  return t('cloudCreditsLeft', {
    remaining: fmt.format(Math.max(0, Math.floor(remaining))),
    limit: fmt.format(Math.floor(credits.limit)),
  })
}

/** "Renews <date>" for a valid period end, else null */
export function renewsText(
  credits: UniworkCloudCredits | null,
  t: TFunc,
  locale: string,
): string | null {
  if (!credits?.periodEnd) return null
  const when = new Date(credits.periodEnd)
  if (Number.isNaN(when.getTime())) return null
  return t('cloudCreditsRenews', {
    date: when.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
  })
}

/**
 * Live cloud status from the shell main process: read once (re-reading the
 * credits) and then kept current by pushes. null until the first answer, or
 * when the preload has no cloud API.
 */
export function useUniworkCloudStatus(): UniworkCloudStatus | null {
  const [status, setStatus] = useState<UniworkCloudStatus | null>(null)
  useEffect(() => {
    let alive = true
    const api = window.aiOffice
    const off = api.onUniworkCloudStatus?.((next) => {
      if (alive) setStatus(next)
    })
    void api
      .uniworkCloudStatus?.()
      .then((first) => {
        if (alive) setStatus((prev) => prev ?? first)
      })
      .catch(() => undefined)
    // credits move with every tool call: opening Settings re-reads them
    void api
      .uniworkCloudRefresh?.()
      .then((fresh) => {
        if (alive) setStatus(fresh)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      off?.()
    }
  }, [])
  return status
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value">{children}</div>
      </div>
    </div>
  )
}

/** Settings → Account, signed in: cloud state and credits (remaining / limit) */
export function UniworkCloudAccountRows({ status }: { status: UniworkCloudStatus | null }) {
  const { t, dateLocale } = useI18n()
  if (!status || status.state === 'signed-out') return null
  const credits =
    status.state === 'not-entitled' || status.state === 'subscription-inactive'
      ? null
      : creditsText(status.credits, t, dateLocale)
  const renews = credits ? renewsText(status.credits, t, dateLocale) : null
  return (
    <section className="cloud-rows" aria-label={t('cloudTitle')} data-cloud-state={status.state}>
      <Row label={t('cloudTitle')}>
        <span className={`cloud-state ${status.state}`}>{t(CLOUD_STATE_KEYS[status.state])}</span>
      </Row>
      {credits && (
        <Row label={t('cloudCredits')}>
          <span className="cloud-credits">{credits}</span>
          {renews && <span className="cloud-renews">{renews}</span>}
        </Row>
      )}
    </section>
  )
}

/** Settings → AI media: what the UniWork cloud does for this user right now */
export function UniworkCloudNotice({
  status,
  onSignIn,
  toolsEnabled = true,
}: {
  status: UniworkCloudStatus | null
  onSignIn?: () => void
  /** the AI model "Use UniWork cloud tools" switch */
  toolsEnabled?: boolean
}) {
  const { t, dateLocale } = useI18n()
  if (!status) return null
  const notice = cloudNoticeFor(status.state, toolsEnabled)
  const credits =
    status.state === 'ready' || status.state === 'credits-exhausted'
      ? creditsText(status.credits, t, dateLocale)
      : null
  return (
    <div
      className={`acct-notice cloud-notice ${notice.tone}`}
      role={notice.tone === 'warn' ? 'alert' : 'status'}
      data-cloud-state={status.state}
    >
      <div className="acct-notice-text">
        <div className="acct-notice-title">{t(notice.title)}</div>
        <div className="acct-notice-body">
          {t(notice.body, { switch: t('cloudToolsToggle'), section: t('setSecAiModel') })}
        </div>
        {credits && (
          <div className="acct-notice-body cloud-notice-credits">
            {t('cloudCredits')}: {credits}
          </div>
        )}
      </div>
      {notice.signIn && onSignIn && (
        <button type="button" className="set-btn primary cloud-notice-action" onClick={onSignIn}>
          {t('acctSignIn')}
        </button>
      )}
    </div>
  )
}
