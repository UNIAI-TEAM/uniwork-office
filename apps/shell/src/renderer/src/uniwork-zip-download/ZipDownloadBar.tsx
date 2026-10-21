import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { formatBytes } from '../doclist/format'
import { useI18n } from '../locale'
import { announce } from '../uniwork-live'
import { viewOf } from './copy'
import { cancelZipRun, closeZipRun, useZipRuns, type StoredZipRun } from './zip-download-store'
import './zip-download.css'

/**
 * `${runId}:${phase}` of every end state already said, for the life of the window: a bar that
 * mounts again (the screen came back) must not say the same end twice.
 */
const announced = new Set<string>()

function Bar({ run }: { run: StoredZipRun }) {
  const { t, dateLocale } = useI18n()
  const bar = viewOf(t, run, (bytes) => formatBytes(bytes, dateLocale))
  const settled = bar.tone !== 'progress'

  // an end state is said once per run and phase; the running percent is never announced
  useEffect(() => {
    if (!settled) return
    const key = `${run.id}:${run.phase}`
    if (announced.has(key)) return
    announced.add(key)
    announce(bar.text, { assertive: bar.tone === 'warn' || bar.tone === 'error' })
    // the text is the change; `t` is not stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, run.id, run.phase])

  useEffect(() => {
    if (bar.clock === null) return
    const timer = window.setTimeout(() => closeZipRun(run.id), bar.clock)
    return () => window.clearTimeout(timer)
    // a new end state restarts the clock
  }, [bar.clock, bar.text, run.id])

  return (
    <div
      className={`zd-bar zd-bar-${bar.tone}`}
      data-testid="zip-download-bar"
      data-phase={run.phase}
    >
      <div className="zd-bar-line">
        <span className="zd-bar-text">{bar.text}</span>
        {bar.cancelable && (
          <button type="button" className="zd-bar-action" onClick={() => void cancelZipRun(run.id)}>
            {t('cancel')}
          </button>
        )}
        {bar.revealable && run.path && (
          <button
            type="button"
            className="zd-bar-action"
            onClick={() => {
              const path = run.path
              if (path) void window.aiOffice.revealPath(path)
              closeZipRun(run.id)
            }}
          >
            {t('uhSourceShowInFolder')}
          </button>
        )}
        {settled && (
          <button
            type="button"
            className="zd-bar-close"
            aria-label={t('uwPickClose')}
            onClick={() => closeZipRun(run.id)}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      {bar.lines.length > 0 && (
        <ul className="zd-bar-lines" data-testid="zip-download-lines">
          {bar.lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
          {bar.more && <li className="zd-bar-more">{bar.more}</li>}
        </ul>
      )}
      {bar.tone === 'progress' && (
        <progress
          className="zd-bar-meter"
          max={100}
          value={bar.percent ?? undefined}
          aria-label={bar.text}
        />
      )}
    </div>
  )
}

const BARS_GUTTER = 16
const BARS_MAX_WIDTH = 380

/**
 * The bars belong to the main pane (the library): measured, so they keep the 16px gutter and
 * the 380px cap inside it, at its right edge (the folder-upload bars take the left). With no
 * pane on screen the stylesheet's corner holds.
 */
function useMainPaneBars(active: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined)
  useLayoutEffect(() => {
    if (!active) return
    const pane = document.querySelector<HTMLElement>('.dh-main')
    if (!pane) {
      setStyle(undefined)
      return
    }
    const measure = () => {
      const box = pane.getBoundingClientRect()
      if (box.width <= 0) {
        setStyle(undefined)
        return
      }
      const width = Math.min(BARS_MAX_WIDTH, box.width - BARS_GUTTER * 2)
      setStyle({ left: box.right - BARS_GUTTER - width, right: 'auto', width })
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(pane)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [active])
  return style
}

/** One bar per Download run (never one per file), at the foot of the main pane */
export function ZipDownloadBar() {
  const { t } = useI18n()
  const runs = useZipRuns()
  const paneStyle = useMainPaneBars(runs.length > 0)
  if (runs.length === 0) return null
  return (
    <div className="zd-bars" style={paneStyle} role="region" aria-label={t('dlActDownload')}>
      {runs.map((run) => (
        <Bar key={run.id} run={run} />
      ))}
    </div>
  )
}
