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
  CREDIT_RATE_NOTE_EN,
  CREDIT_RATE_NOTE_VI,
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
  const { lang, dateLocale } = useI18n()
  const vi = lang === 'vi'
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
    const onFocus = () => void refresh()
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

  const label = (a: string, b: string) => (vi ? a : b)
  const fmt = (n: number) => formatCreditCount(n, dateLocale)
  const fmtEst = (n: number) => formatEstCredits(n, dateLocale)

  let title: string
  let sub: string
  if (snap.missingKey) {
    title = label('Ví Credit', 'Credit wallet')
    sub = label('Chưa gắn Token Hub', 'No Token Hub key')
  } else if (!snap.ok) {
    title = label('Ví Credit', 'Credit wallet')
    sub = busy
      ? label('Đang cập nhật…', 'Updating…')
      : label('Không đọc được số dư', 'Couldn’t load balance')
  } else if (snap.unlimited || snap.remaining == null) {
    title = label('Ví Credit', 'Credit wallet')
    sub = label(`Đã dùng ${fmt(snap.used)}`, `Used ${fmt(snap.used)}`)
  } else {
    title = label(`Còn ${fmt(snap.remaining)} Credit`, `${fmt(snap.remaining)} Credits left`)
    sub = label(`Đã dùng ${fmt(snap.used)}`, `Used ${fmt(snap.used)}`)
  }

  if (todayCredits > 0) {
    sub = `${sub} · ${label(`Hôm nay ≈ ${fmtEst(todayCredits)}`, `Today ≈ ${fmtEst(todayCredits)}`)}`
  }

  const tip = [
    title,
    sub,
    vi ? CREDIT_RATE_NOTE_VI : CREDIT_RATE_NOTE_EN,
    label(
      'Nhật ký AI trên máy (ước lượng). Bấm Ví → Settings; mũi tên → lịch sử.',
      'On-device AI log (estimated). Click wallet → Settings; chevron → history.',
    ),
  ].join('\n')

  return (
    <div className="credit-wallet-wrap">
      <div className="credit-wallet-row">
        <button
          type="button"
          className={`credit-wallet${snap.missingKey ? ' is-empty' : ''}${!snap.ok && !snap.missingKey ? ' is-warn' : ''}`}
          onClick={() => onOpenAiSettings()}
          onContextMenu={(e) => {
            e.preventDefault()
            void window.aiOffice.openCreditUsage?.()
          }}
          data-tip={tip}
          aria-label={tip}
          title={tip}
        >
          <span className="credit-wallet-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect
                x="1.75"
                y="4"
                width="12.5"
                height="9"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M1.75 6.5h12.5M10.5 10.2h2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="credit-wallet-text">
            <span className="credit-wallet-title">{title}</span>
            <span className="credit-wallet-sub">
              {busy && snap.ok ? label('Đang cập nhật…', 'Updating…') : sub}
            </span>
          </span>
        </button>
        <button
          type="button"
          className={`credit-wallet-toggle${openLog ? ' is-open' : ''}`}
          aria-expanded={openLog}
          aria-label={label('Nhật ký Credit', 'Credit history')}
          title={label('Nhật ký tiêu thụ AI', 'AI usage history')}
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
      {openLog ? (
        <div className="credit-wallet-log" role="region" aria-label={label('Nhật ký', 'History')}>
          <p className="credit-wallet-log-note">
            {label(
              'Ước lượng trên máy (chưa phải hóa đơn Hub).',
              'On-device estimate (not the Hub invoice).',
            )}
          </p>
          {recent.length === 0 ? (
            <p className="credit-wallet-log-empty">
              {label('Chưa có lần gọi AI nào được ghi.', 'No AI calls logged yet.')}
            </p>
          ) : (
            <ul className="credit-wallet-log-list">
              {recent.map((e) => (
                <li key={e.id} className={!e.ok ? 'is-fail' : undefined}>
                  <span className="credit-wallet-log-time">
                    {formatTime(e.at, dateLocale)}
                  </span>
                  <span className="credit-wallet-log-sum" title={e.summary}>
                    {e.summary || e.source}
                  </span>
                  <span className="credit-wallet-log-cred">
                    {e.ok && !e.cancelled
                      ? `≈ ${fmtEst(e.estCredits)}`
                      : label('—', '—')}
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
