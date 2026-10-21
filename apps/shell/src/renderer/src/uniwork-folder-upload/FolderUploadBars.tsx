import { useEffect } from 'react'
import { announce } from '../uniwork-live'
import { useI18n, type StringKey, type TFunc } from '../locale'
import { pluralKey } from './copy'
import type { FolderUploadRun } from './use-folder-upload'
import './folder-upload.css'

const SUCCESS_MS = 10_000
const CANCELED_MS = 6_000

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
        text: t(folder ? 'fuBarFailed' : 'fuBarFailedFiles', { name: run.name }),
        percent: null,
        action: null,
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

  // an end state is said once; the running count is never announced (it changes too often)
  useEffect(() => {
    if (settled) announce(bar.text, { assertive: bar.tone === 'warn' || bar.tone === 'error' })
    // the text is the change; `t` is not stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, bar.text])

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

/** One overall bar per run (never one per file), stacked at the foot of the library */
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
  if (runs.length === 0) return null
  return (
    <div className="fu-bars" role="region" aria-label={t('uhUpload')}>
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
