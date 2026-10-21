import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { announce } from '../uniwork-live'
import { useI18n, type StringKey, type TFunc } from '../locale'
import { pluralKey, runErrorMessage } from './copy'
import type { FolderUploadRun } from './use-folder-upload'
import './folder-upload.css'

const SUCCESS_MS = 10_000
const CANCELED_MS = 6_000

/**
 * `${runId}:${phase}` of every end state already said, for the life of the
 * window: a bar that mounts again (a screen came back, a retry changed the
 * count) must not say the same end again.
 */
const announced = new Set<string>()
const END_PHASES = ['done', 'canceled', 'failed'] as const

type Tone = 'progress' | 'ok' | 'info' | 'warn' | 'error'

interface BarView {
  tone: Tone
  text: string
  /** 0-100 while a run is under way; null = not known yet (preparing) */
  percent: number | null
  /** the one command of the end state */
  action: { label: StringKey; onClick: () => void } | null
  cancelable: boolean
  /** ms until the bar leaves on its own; null = it waits for ×, or for a decision */
  clock: number | null
}

function view(
  t: TFunc,
  run: FolderUploadRun,
  handlers: { onOpenFolder?: (folderId: string) => void; onView: () => void },
): BarView {
  const folder = run.mode === 'folder'
  const counts = { done: run.done, total: run.total, name: run.name }
  switch (run.phase) {
    case 'planning':
      return {
        tone: 'progress',
        text: t(folder ? 'fuBarPreparing' : 'fuBarPreparingFiles', { name: run.name }),
        percent: null,
        action: null,
        cancelable: true,
        clock: null,
      }
    case 'uploading':
    case 'finishing':
      return {
        tone: 'progress',
        text: t(folder ? 'fuBarRunning' : 'fuBarRunningFiles', counts),
        percent: run.total > 0 ? Math.min(100, Math.round((run.done / run.total) * 100)) : 0,
        action: null,
        cancelable: true,
        clock: null,
      }
    case 'canceled':
      return {
        tone: 'info',
        text:
          run.done > 0
            ? t(pluralKey('fuBarCanceled', run.done), { count: run.done })
            : t('fuBarCanceledNone'),
        percent: null,
        action: null,
        cancelable: false,
        clock: CANCELED_MS,
      }
    case 'failed':
      return {
        tone: 'error',
        text:
          runErrorMessage(t, run.error, run) ??
          t(folder ? 'fuBarFailed' : 'fuBarFailedFiles', { name: run.name }),
        percent: null,
        // a failed run that set files aside (could not open them) can say which
        action: run.failures.length > 0 ? { label: 'fuBarView', onClick: handlers.onView } : null,
        cancelable: false,
        clock: null,
      }
    case 'done':
      if (run.failed > 0) {
        return {
          tone: 'warn',
          text: t('fuBarPartial', { done: run.done, total: run.total, failed: run.failed }),
          percent: null,
          action: { label: 'fuBarView', onClick: handlers.onView },
          cancelable: false,
          clock: null,
        }
      }
      return {
        tone: 'ok',
        text: folder
          ? t(pluralKey('fuBarDone', run.done), { count: run.done, name: run.name })
          : t(pluralKey('fuBarDoneFiles', run.done), { count: run.done }),
        percent: null,
        action:
          folder && run.rootFolderId && handlers.onOpenFolder
            ? {
                label: 'fuBarOpenFolder',
                onClick: () => handlers.onOpenFolder?.(run.rootFolderId as string),
              }
            : null,
        cancelable: false,
        clock: SUCCESS_MS,
      }
  }
}

function Bar({
  run,
  onCancel,
  onOpenReport,
  onOpenFolder,
  onClose,
}: {
  run: FolderUploadRun
  onCancel: () => void
  onOpenReport: () => void
  onOpenFolder?: (folderId: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const bar = view(t, run, { onOpenFolder, onView: onOpenReport })
  const settled = bar.tone !== 'progress'

  // an end state is said once per run and phase; the running count is never announced (it changes too often)
  useEffect(() => {
    if (!settled) {
      // a retry is under way: its next end is news again
      for (const phase of END_PHASES) announced.delete(`${run.runId}:${phase}`)
      return
    }
    const key = `${run.runId}:${run.phase}`
    if (announced.has(key)) return
    announced.add(key)
    announce(bar.text, { assertive: bar.tone === 'warn' || bar.tone === 'error' })
    // the text is the change; `t` is not stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, run.runId, run.phase])

  useEffect(() => {
    if (bar.clock === null) return
    const timer = window.setTimeout(onClose, bar.clock)
    return () => window.clearTimeout(timer)
    // a new end state restarts the clock
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bar.clock, bar.text])

  return (
    <div
      className={`fu-bar fu-bar-${bar.tone}`}
      data-testid="folder-upload-bar"
      data-phase={run.phase}
    >
      <div className="fu-bar-line">
        <span className="fu-bar-text">{bar.text}</span>
        {bar.cancelable && (
          <button type="button" className="fu-bar-action" onClick={onCancel}>
            {t('fuBarCancelAll')}
          </button>
        )}
        {bar.action && (
          <button
            type="button"
            className="fu-bar-action"
            onClick={() => {
              bar.action?.onClick()
              // Open folder is a final answer; View opens the report and keeps the bar behind it
              if (bar.action?.label === 'fuBarOpenFolder') onClose()
            }}
          >
            {t(bar.action.label)}
          </button>
        )}
        {settled && (
          <button
            type="button"
            className="fu-bar-close"
            aria-label={t('uwPickClose')}
            onClick={onClose}
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
      {bar.tone === 'progress' && (
        <progress
          className="fu-bar-meter"
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
 * FU-V3: the bars belong to the main pane (the library), not to the window's
 * bottom-left corner where they covered the sidebar's own entries. The pane
 * is measured, so the bars keep the same 16px gutter and 380px cap inside it;
 * with no pane on screen (a host without one) the stylesheet's corner holds.
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
      setStyle({
        left: box.left + BARS_GUTTER,
        width: Math.min(BARS_MAX_WIDTH, box.width - BARS_GUTTER * 2),
      })
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

/** One overall bar per run (never one per file), stacked at the foot of the main pane */
export function FolderUploadBars({
  runs,
  onCancel,
  onOpenReport,
  onOpenFolder,
  onClose,
}: {
  runs: readonly FolderUploadRun[]
  onCancel: (runId: string) => void
  onOpenReport: (runId: string) => void
  onOpenFolder?: (folderId: string) => void
  onClose: (runId: string) => void
}) {
  const { t } = useI18n()
  const paneStyle = useMainPaneBars(runs.length > 0)
  if (runs.length === 0) return null
  return (
    <div className="fu-bars" style={paneStyle} role="region" aria-label={t('uhUpload')}>
      {runs.map((run) => (
        <Bar
          key={run.runId}
          run={run}
          onCancel={() => onCancel(run.runId)}
          onOpenReport={() => onOpenReport(run.runId)}
          onOpenFolder={onOpenFolder}
          onClose={() => onClose(run.runId)}
        />
      ))}
    </div>
  )
}
