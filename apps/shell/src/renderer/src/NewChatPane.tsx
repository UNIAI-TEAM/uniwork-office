import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useI18n } from './locale'
import { AskUniHost } from './AskUniHost'
import { consumeAskUniOpen, useAskUniOpenRequest } from './askuni-entry'
import { FileBadge } from './FileBadge'
import type { RecentEntry } from '../../shared/home-api'

/** "2 giờ trước" / "2 hours ago"; past a week, a short date. */
function relativeTime(ms: number, vi: boolean, now = Date.now()): string {
  const locale = vi ? 'vi' : 'en'
  const sec = Math.round((ms - now) / 1000)
  const abs = Math.abs(sec)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  if (abs < 7 * 86400) return rtf.format(Math.round(sec / 86400), 'day')
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(ms)
}

/** The three newest reachable recents (no AI involved). */
async function loadContinueFiles(): Promise<RecentEntry[]> {
  const page = await window.aiOffice.recents({ offset: 0, limit: 12 })
  return page.entries.filter((e) => !e.missing).slice(0, 3)
}

/**
 * Home's chat pane: Ask UNI, the one AI chat on this screen, with the "pick up where you left off"
 * list beside it. A request from elsewhere (Ctrl/Cmd+J) puts the caret in its composer; the host
 * shows its own signed-out and no-workspace states.
 */
export function NewChatPane(): ReactElement {
  const { lang, t } = useI18n()
  const vi = lang === 'vi'
  const [askFocusToken, setAskFocusToken] = useState(0)
  const [continueFiles, setContinueFiles] = useState<RecentEntry[]>([])
  const [openError, setOpenError] = useState<string | null>(null)
  const askOpenRequest = useAskUniOpenRequest()
  const askRequestSeq = askOpenRequest?.seq ?? null
  useEffect(() => {
    if (askRequestSeq === null) return
    setAskFocusToken((n) => n + 1)
    consumeAskUniOpen(askRequestSeq)
  }, [askRequestSeq])

  useEffect(() => {
    let alive = true
    const refresh = () => {
      loadContinueFiles()
        .then((entries) => {
          if (alive) setContinueFiles(entries)
        })
        .catch(() => {
          if (alive) setContinueFiles([])
        })
    }
    // no recents-changed event exists; coming back from a document tab focuses/reveals Home
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <main className="new-chat is-ask" aria-label={t('askUniTitle')}>
      <header className="new-chat-bar">
        <h1 className="new-chat-title">{t('askUniTitle')}</h1>
      </header>
      {continueFiles.length > 0 ? (
        <section className="new-chat-continue" aria-labelledby="new-chat-continue-title">
          <h3 id="new-chat-continue-title" className="new-chat-continue-title">
            {vi ? 'Làm tiếp' : 'Pick up where you left off'}
          </h3>
          <ul className="new-chat-continue-list">
            {continueFiles.map((f) => (
              <li key={f.path} className="new-chat-continue-row">
                <button
                  type="button"
                  className="new-chat-continue-open"
                  title={f.path}
                  onClick={() => {
                    setOpenError(null)
                    window.aiOffice.openPath(f.path).catch((err: unknown) => {
                      const why = err instanceof Error ? err.message : String(err)
                      setOpenError(
                        vi
                          ? `Không mở được “${f.name}”: ${why}`
                          : `Couldn’t open “${f.name}”: ${why}`,
                      )
                    })
                  }}
                >
                  <FileBadge ext={f.ext} size={28} />
                  <span className="new-chat-continue-name">{f.name}</span>
                  <span className="new-chat-continue-time">{relativeTime(f.mtimeMs, vi)}</span>
                </button>
              </li>
            ))}
          </ul>
          {openError ? (
            <p className="askuni-note" role="alert">
              {openError}
            </p>
          ) : null}
        </section>
      ) : null}
      <AskUniHost visible focusToken={askFocusToken} />
    </main>
  )
}
