// UNI-2068: the words of the bulk Download result, pure so the keys can be tested without
// rendering. vi/en are the web's `documents.list.bulk.*` copy; the app-only lines are the
// busy / cancel / canceled / downloading ones.
import type { ZipDownloadErrorCode, ZipSkipReason } from '../../../shared/zip-download-api'
import type { StringKey, TFunc } from '../locale'
import type { ResultLine } from './zip-plan'

/** the result lists this many "title: reason" lines, then "and N more" */
export const RESULT_LINES_MAX = 5

const REASON_KEYS: Record<ZipSkipReason | 'failed', StringKey> = {
  not_a_file: 'dlZipErrNotAFile',
  not_found: 'dlZipErrNotFound',
  too_large: 'dlZipErrTooLarge',
  zip_limit: 'dlZipErrLimit',
  other_workspace: 'dlZipErrOtherWorkspace',
  failed: 'dlZipErrFailed',
}

export function reasonKeyOf(reason: ResultLine['reason']): StringKey {
  return REASON_KEYS[reason]
}

/** the sentence of a run that did not produce its file */
export function errorKeyOf(code: ZipDownloadErrorCode): StringKey {
  switch (code) {
    case 'zip_too_large':
    case 'too_large':
      return 'dlZipTooLarge'
    case 'zip_expired':
      return 'dlZipExpired'
    case 'zip_busy':
      return 'dlZipBusy'
    case 'zip_timeout':
      return 'dlZipTimeout'
    case 'zip_unavailable':
      return 'dlZipUnavailable'
    case 'forbidden_target':
    case 'write_failed':
      return 'dlZipSaveFailed'
    case 'canceled':
      return 'dlZipCanceled'
    default:
      return 'dlZipFailed'
  }
}

export interface ResultSummary {
  headline: string
  /** at most RESULT_LINES_MAX "title: reason" lines */
  lines: string[]
  /** "and N more", or null when every line is shown */
  more: string | null
}

export function resultSummary(
  t: TFunc,
  result: { ok: number; total: number; lines: readonly ResultLine[] },
): ResultSummary {
  const shown = result.lines.slice(0, RESULT_LINES_MAX)
  const left = result.lines.length - shown.length
  return {
    headline: t('dlBulkDoneDownload', { ok: result.ok, total: result.total }),
    lines: shown.map((line) =>
      t('dlZipErrorLine', {
        title: line.title.trim() || t('shrBulkUntitled'),
        reason: t(reasonKeyOf(line.reason)),
      }),
    ),
    more: left > 0 ? t(left === 1 ? 'dlZipMoreOne' : 'dlZipMore', { count: left }) : null,
  }
}

/** the fields of a stored run the bar reads (the store's `StoredZipRun` fits) */
export interface RunFacts {
  kind: 'zip' | 'file'
  phase: 'saving' | 'building' | 'downloading' | 'done' | 'canceled' | 'failed'
  bytes: number
  totalBytes: number | null
  total: number
  ok: number
  lines: readonly ResultLine[]
  fileName: string | null
  path: string | null
  error: ZipDownloadErrorCode | null
}

export type BarTone = 'progress' | 'ok' | 'warn' | 'error' | 'info'

export interface BarView {
  tone: BarTone
  text: string
  /** the "title: reason" lines of a finished run (at most RESULT_LINES_MAX) */
  lines: string[]
  more: string | null
  /** 0-100 while bytes are coming; null = not known yet (preparing, or no total) */
  percent: number | null
  cancelable: boolean
  /** the saved file can be shown in its folder */
  revealable: boolean
  /** ms until the bar leaves on its own; null = it waits for ×, so the lines can be read */
  clock: number | null
}

export const DONE_CLOCK_MS = 10_000
export const CANCELED_CLOCK_MS = 6_000

export function viewOf(t: TFunc, run: RunFacts, formatSize: (bytes: number) => string): BarView {
  const base = { lines: [], more: null, percent: null, cancelable: false, revealable: false }
  switch (run.phase) {
    case 'saving':
    case 'building':
      return {
        ...base,
        tone: 'progress',
        text: t('dlZipPreparing'),
        cancelable: run.kind === 'zip',
        clock: null,
      }
    case 'downloading': {
      const percent =
        run.totalBytes && run.totalBytes > 0
          ? Math.min(100, Math.round((run.bytes / run.totalBytes) * 100))
          : null
      return {
        ...base,
        tone: 'progress',
        text:
          percent === null
            ? t('dlZipDownloadingSize', { size: formatSize(run.bytes) })
            : t('dlZipDownloading', { percent }),
        percent,
        cancelable: true,
        clock: null,
      }
    }
    case 'canceled':
      return { ...base, tone: 'info', text: t('dlZipCanceled'), clock: CANCELED_CLOCK_MS }
    case 'failed': {
      if (run.kind === 'file') {
        // the file's own line ("name: too large to download"), or the save sentence when the
        // file could not be written; the rows left out follow as lines
        const saveFailed = run.error === 'forbidden_target' || run.error === 'write_failed'
        const own = resultSummary(t, { ok: 0, total: run.total, lines: run.lines.slice(0, 1) })
        const rest = resultSummary(t, { ok: 0, total: run.total, lines: run.lines.slice(1) })
        return {
          ...base,
          tone: 'error',
          text: saveFailed ? t(errorKeyOf(run.error!)) : (own.lines[0] ?? t('dlZipFailed')),
          lines: rest.lines,
          more: rest.more,
          clock: null,
        }
      }
      return { ...base, tone: 'error', text: t(errorKeyOf(run.error ?? 'zip_failed')), clock: null }
    }
    case 'done': {
      const revealable = run.path !== null
      if (run.kind === 'file' && run.lines.length === 0) {
        return {
          ...base,
          tone: 'ok',
          text: t('uhSourceDownloaded', { name: run.fileName ?? '' }),
          revealable,
          clock: DONE_CLOCK_MS,
        }
      }
      const summary = resultSummary(t, run)
      return {
        tone: run.lines.length === 0 ? 'ok' : run.ok > 0 ? 'warn' : 'error',
        text: summary.headline,
        lines: summary.lines,
        more: summary.more,
        percent: null,
        cancelable: false,
        revealable,
        // a result with lines to read stays until it is closed
        clock: run.lines.length === 0 ? DONE_CLOCK_MS : null,
      }
    }
  }
}
