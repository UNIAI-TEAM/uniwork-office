import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AiSettings } from '@genoffice/ai-provider'
import type {
  UniworkCloudCredits,
  UniworkCloudState,
  UniworkCloudStatus,
} from '@genoffice/ai-provider/browser'
import { useI18n } from './locale'
import type { StringKey, TFunc } from './locale'

/**
 * UniWork cloud AI in Settings: the status/credits rows under the account
 * (signed in only) and the cloud tools switch. The status comes
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
 * credits), kept current by pushes, and re-read when the window regains focus. null until the first answer, or
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
    // the plan can change on the server at any time (the main process rate-limits the
    // re-read): coming back to the window re-reads it, so no pane waits for a reopen
    const reread = () => {
      if (document.visibilityState === 'hidden') return
      void api
        .uniworkCloudRefresh?.()
        .then((fresh) => {
          if (alive) setStatus(fresh)
        })
        .catch(() => undefined)
    }
    window.addEventListener('focus', reread)
    document.addEventListener('visibilitychange', reread)
    return () => {
      alive = false
      off?.()
      window.removeEventListener('focus', reread)
      document.removeEventListener('visibilitychange', reread)
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

/**
 * Settings → Account, while the org has cloud AI: the "Use UniWork cloud tools" switch.
 * Off keeps web search, image and media tools out of UniWork AI turns (gskToolsEnabled in
 * ai-settings.json; absent reads as on).
 */
export function UniworkCloudToolsSwitch() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<AiSettings | null>(null)
  useEffect(() => {
    let alive = true
    void window.aiOffice
      .getAiSettings?.()
      .then((stored) => {
        if (alive) setSettings(stored)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  const on = settings?.gskToolsEnabled !== false
  const flip = () => {
    if (!settings) return
    const next = { ...settings, gskToolsEnabled: !on }
    setSettings(next)
    // a refused save re-reads what is actually stored
    void window.aiOffice.setAiSettings(next).catch(() =>
      window.aiOffice
        .getAiSettings?.()
        .then(setSettings)
        .catch(() => undefined),
    )
  }
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-stack">
          <div className="set-field-label">{t('cloudToolsToggle')}</div>
          <div className="set-field-desc">{t('cloudToolsToggleDesc')}</div>
        </div>
      </div>
      <button
        className="set-switch"
        role="switch"
        aria-checked={on}
        aria-label={t('cloudToolsToggle')}
        disabled={!settings}
        onClick={flip}
      />
    </div>
  )
}
