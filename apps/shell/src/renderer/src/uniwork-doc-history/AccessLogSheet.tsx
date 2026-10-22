import { useId, useState } from 'react'
import type {
  DocAccessLog,
  DocAccessLogAction,
  UniworkDocHistoryApi,
} from '../../../shared/doc-history-api'
import { useI18n, type TFunc } from '../locale'
import { ActionModal } from '../UniworkDocActions'
import {
  ACCESS_LOG_FILTERS,
  accessLogActionKey,
  accessLogActor,
  accessLogViaKey,
  canReadAccessLog,
  type AccessLogGateRow,
} from './access-log-model'
import { getDocHistoryBridge } from './bridge'
import { useAccessLogs } from './use-access-logs'
import './access-log-sheet.css'

/** what the sheet reads of a document: a list row satisfies it as is */
export type AccessLogSheetTarget = Pick<AccessLogGateRow, 'myLevel' | 'adminScope'> & {
  id: string
  title?: string
}

export interface AccessLogSheetProps {
  open: boolean
  onClose: () => void
  row: AccessLogSheetTarget
  /** the bridge; defaults to `window.uniworkDocHistory` (tests pass the in-memory fake) */
  api?: UniworkDocHistoryApi | null
}

/**
 * The Access log sheet, a clone of the web's: who viewed, downloaded, exported or opened the
 * document through a link. Manage-only by the server's own rule; the sheet degrades to the
 * explanation when the level drops while it is open. Rows carry the resolved actor when the
 * server has one, and the anonymous / system kinds when it does not.
 */
export function AccessLogSheet(props: AccessLogSheetProps) {
  if (!props.open) return null
  return <AccessLogSheetBody {...props} />
}

function formatWhen(at: string, locale: string): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return new Intl.DateTimeFormat(
    locale,
    sameDay ? { hour: '2-digit', minute: '2-digit' } : { dateStyle: 'medium', timeStyle: 'short' },
  ).format(date)
}

function metaLine(log: DocAccessLog, t: TFunc): string {
  const parts: string[] = [t(accessLogActionKey(log.action))]
  if (log.via) {
    const key = accessLogViaKey(log.via)
    parts.push(key ? t(key) : log.via)
  }
  if (log.version) parts.push(t('algVersion', { no: log.version }))
  return parts.join(' · ')
}

function AccessLogSheetBody({ onClose, row, api }: AccessLogSheetProps) {
  const { t, dateLocale } = useI18n()
  const titleId = useId()
  const descriptionId = useId()
  const bridge = api === undefined ? getDocHistoryBridge() : api
  const canRead = canReadAccessLog(row)
  const [action, setAction] = useState<'' | DocAccessLogAction>('')
  const logs = useAccessLogs(bridge, row.id, action, canRead)
  const manageOnly = !canRead || logs.status === 'forbidden'

  return (
    <ActionModal
      labelledBy={titleId}
      describedBy={descriptionId}
      className="alg-sheet"
      onCancel={onClose}
    >
      <header className="alg-header">
        <div className="alg-header-text">
          <h2 id={titleId} className="uw-act-heading alg-title">
            {t('algTitle')}
          </h2>
          <p id={descriptionId} className="alg-muted">
            {t('algDescription')}
          </p>
          {row.title ? (
            <p className="alg-doc" title={row.title}>
              {row.title}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="alg-close"
          data-access-log-close
          aria-label={t('shrCloseLabel')}
          onClick={onClose}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {manageOnly ? (
        <p className="alg-note" data-access-log-manage-only>
          {t('algManageOnly')}
        </p>
      ) : (
        <>
          <label className="alg-filter">
            <span className="alg-sr">{t('algFilterLabel')}</span>
            <select
              className="uw-act-select"
              aria-label={t('algFilterLabel')}
              value={action}
              onChange={(event) => setAction(event.target.value as '' | DocAccessLogAction)}
            >
              {ACCESS_LOG_FILTERS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? t(accessLogActionKey(value)) : t('algFilterAll')}
                </option>
              ))}
            </select>
          </label>

          {logs.status === 'loading' ? (
            <div className="alg-loading" data-access-log-loading aria-busy="true">
              <span className="alg-sr" role="status">
                {t('algLoading')}
              </span>
              <span className="alg-skeleton" aria-hidden="true" />
              <span className="alg-skeleton" aria-hidden="true" />
              <span className="alg-skeleton short" aria-hidden="true" />
            </div>
          ) : logs.status === 'error' ? (
            <div className="alg-error">
              <p role="alert" className="alg-error-text">
                {t('algError')}
              </p>
              <button type="button" className="btn" onClick={logs.retry}>
                {t('shrRetry')}
              </button>
            </div>
          ) : logs.rows.length === 0 ? (
            <p className="alg-muted alg-empty" data-access-log-empty>
              {t('algEmpty')}
            </p>
          ) : (
            <>
              <ul className="alg-list">
                {logs.rows.map((log) => {
                  const actor = accessLogActor(log)
                  const breakGlass = log.via === 'break_glass'
                  return (
                    <li
                      key={log.id}
                      className="alg-row"
                      data-access-log-row={log.id}
                      data-via={log.via || undefined}
                    >
                      <div className="alg-row-main">
                        <p className="alg-actor" data-access-log-actor>
                          {'name' in actor ? actor.name : t(actor.key)}
                        </p>
                        <p className="alg-meta" data-access-log-meta>
                          {metaLine(log, t)}
                        </p>
                        {breakGlass ? (
                          <span
                            className="alg-break-glass"
                            data-access-log-break-glass
                            aria-hidden="true"
                          >
                            {t('shrBgViaBreakGlass')}
                          </span>
                        ) : null}
                      </div>
                      <time className="alg-time" dateTime={log.occurred_at}>
                        {formatWhen(log.occurred_at, dateLocale)}
                      </time>
                    </li>
                  )
                })}
              </ul>
              {logs.moreFailed ? (
                <p role="alert" className="alg-error-text alg-more-error">
                  {t('algError')}
                </p>
              ) : null}
              {logs.hasMore ? (
                <div className="alg-more">
                  <button
                    type="button"
                    className="btn"
                    disabled={logs.loadingMore}
                    aria-busy={logs.loadingMore || undefined}
                    onClick={logs.loadMore}
                  >
                    {t('shrCandidatesMore')}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </ActionModal>
  )
}
