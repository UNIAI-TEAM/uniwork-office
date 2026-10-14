import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { OpenRouterKeyStatus } from '@genoffice/ai-provider'
import {
  formatEstCredits,
  listAiUsage,
  localDayStartIso,
  sumAiUsageCreditsSince,
  type AiUsageEntry,
} from './ai-usage-ledger'
import {
  creditWalletFromOpenRouter,
  formatCreditCount,
  type CreditWalletSnapshot,
} from './credit-wallet'
import { useI18n } from './locale'

type Props = {
  onOpenAiSettings: () => void
}

function hubKeyFromSettings(settings: {
  providers?: Record<string, { apiKey?: string } | undefined>
}): string {
  return (
    settings.providers?.genspark?.apiKey?.trim() ||
    settings.providers?.openrouter?.apiKey?.trim() ||
    ''
  )
}

const FOCUS_REFRESH_MS = 60_000

function formatTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    )
  } catch {
    return iso.slice(11, 16)
  }
}

export function CreditWallet({ onOpenAiSettings }: Props): ReactElement {
  const { t, dateLocale } = useI18n()
  const [snap, setSnap] = useState<CreditWalletSnapshot>(() =>
    creditWalletFromOpenRouter(null, false),
  )
  const [busy, setBusy] = useState(false)
  const [todayCredits, setTodayCredits] = useState(0)
  const [recent, setRecent] = useState<AiUsageEntry[]>([])
  const [openLog, setOpenLog] = useState(false)

  const refreshLedger = useCallback(() => {
    setTodayCredits(sumAiUsageCreditsSince(localDayStartIso()))
    setRecent(listAiUsage(8))
  }, [])

  const refresh = useCallback(async () => {
    refreshLedger()
    if (!window.aiOffice.getAiSettings || !window.aiOffice.probeOpenRouterKey) {
      setSnap(creditWalletFromOpenRouter(null, false))
      return
    }
    setBusy(true)
    try {
      const settings = await window.aiOffice.getAiSettings()
      const key = hubKeyFromSettings(settings)
      if (!key) {
        setSnap(creditWalletFromOpenRouter(null, false))
        return
      }
      const status = (await window.aiOffice.probeOpenRouterKey(key)) as OpenRouterKeyStatus
      setSnap(creditWalletFromOpenRouter(status, true))
    } catch (err) {
      setSnap({
        ok: false,
        missingKey: false,
        remaining: null,
        used: 0,
        unlimited: false,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }, [refreshLedger])

  useEffect(() => {
    void refresh()
    // coming back to the window re-reads the balance at most once a minute: every
    // alt-tab would otherwise be a request to the key provider
    let lastFocusRefresh = Date.now()
    const onFocus = () => {
      if (Date.now() - lastFocusRefresh < FOCUS_REFRESH_MS) return
      lastFocusRefresh = Date.now()
      void refresh()
    }
    const onCustom = () => void refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener('uniwork:credit-refresh', onCustom)
    const timer = window.setInterval(() => void refresh(), 5 * 60_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('uniwork:credit-refresh', onCustom)
      window.clearInterval(timer)
    }
  }, [refresh])

  const fmt = (n: number) => formatCreditCount(n, dateLocale)
  const fmtEst = (n: number) => formatEstCredits(n, dateLocale)

  // one value on the right of the row; the meter only when the key has a limit
  let value: string
  let tone: 'cta' | 'warn' | '' = ''
  let share: number | null = null
  if (snap.missingKey) {
    value = t('cwAddKey')
    tone = 'cta'
  } else if (!snap.ok) {
    value = busy ? t('cwUpdating') : t('cwLoadFailed')
    if (!busy) tone = 'warn'
  } else if (snap.unlimited || snap.remaining == null) {
    value = t('cwUsed', { n: fmt(snap.used) })
  } else {
    value = t('cwLeft', { n: fmt(snap.remaining) })
    const total = snap.remaining + snap.used
    share = total > 0 ? snap.remaining / total : 0
  }
  const status = snap.missingKey ? t('cwNoKey') : value
  const tip = [
    `${t('cwTitle')}: ${status}`,
    todayCredits > 0 ? t('cwToday', { n: fmtEst(todayCredits) }) : '',
    t('setAiCreditRate'),
    t('cwOpenHint'),
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className="credit-wallet-wrap">
      <div className="credit-wallet-row">
        <button
          type="button"
          className="credit-wallet"
          onClick={() => onOpenAiSettings()}
          onContextMenu={(e) => {
            e.preventDefault()
            void window.aiOffice.openCreditUsage?.()
          }}
          data-tip={tip}
          aria-label={`${t('cwTitle')}: ${status}`}
        >
          <span className="credit-wallet-title">{t('cwTitle')}</span>
          <span className={`credit-wallet-value${tone ? ` is-${tone}` : ''}`}>{value}</span>
        </button>
        <button
          type="button"
          className={`credit-wallet-toggle${openLog ? ' is-open' : ''}`}
          aria-expanded={openLog}
          aria-controls="credit-wallet-log"
          aria-label={t('cwHistory')}
          data-tip={t('cwHistory')}
          onClick={() => {
            refreshLedger()
            setOpenLog((v) => !v)
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M3 4.5 6 7.5 9 4.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {share !== null && (
        <div
          className={`credit-wallet-meter${share < 0.1 ? ' is-low' : ''}`}
          role="meter"
          aria-label={t('cwTitle')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
          aria-valuetext={value}
        >
          <span style={{ transform: `scaleX(${Math.max(0.02, share)})` }} />
        </div>
      )}
      {todayCredits > 0 && (
        <div className="credit-wallet-today">{t('cwToday', { n: fmtEst(todayCredits) })}</div>
      )}
      {openLog ? (
        <div
          id="credit-wallet-log"
          className="credit-wallet-log"
          role="region"
          aria-label={t('cwHistory')}
        >
          <p className="credit-wallet-log-note">{t('cwLogNote')}</p>
          {recent.length === 0 ? (
            <p className="credit-wallet-log-empty">{t('cwLogEmpty')}</p>
          ) : (
            <ul className="credit-wallet-log-list">
              {recent.map((e) => (
                <li key={e.id} className={!e.ok ? 'is-fail' : undefined}>
                  <span className="credit-wallet-log-time">{formatTime(e.at, dateLocale)}</span>
                  <span className="credit-wallet-log-sum" data-tip={e.summary}>
                    {e.summary || e.source}
                  </span>
                  <span className="credit-wallet-log-cred">
                    {e.ok && !e.cancelled ? `≈ ${fmtEst(e.estCredits)}` : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
