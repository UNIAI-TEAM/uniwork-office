import { useEffect, useId, useRef } from 'react'
import type { UniworkDocErrorCode } from '../../shared/home-api'
import { useI18n } from './locale'
import { UNIWORK_ERROR_KEYS, docInfoRows, type DocInfoFields } from './uniwork-docs-model'

export type DocInfoLoad =
  | { status: 'loading' }
  | { status: 'ready'; info: DocInfoFields }
  | { status: 'error'; error: UniworkDocErrorCode }

/**
 * Details of one UniWork document, shown beside the picker list as a
 * non-modal panel named by the document title. Owner, created / updated by
 * and when, my access and the current version; a field the server did not
 * send reads "—".
 */
export function UniworkDocInfoPanel({
  title,
  load,
  onClose,
  onRetry,
}: {
  title: string
  load: DocInfoLoad
  onClose: () => void
  onRetry: () => void
}) {
  const { t, dateLocale } = useI18n()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const titleId = `uw-info-title-${useId().replace(/:/g, '')}`

  // the panel takes focus once on open so screen readers announce the document
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <section
      className="uw-info"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-busy={load.status === 'loading'}
    >
      <div className="uw-info-head">
        <h4 className="uw-info-title" id={titleId} ref={headingRef} tabIndex={-1}>
          {title}
        </h4>
        <button
          type="button"
          className="uw-pick-close"
          aria-label={t('uwDocInfoClose')}
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3 3l8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      {load.status === 'loading' && (
        <div className="uw-info-skeleton" role="status">
          <span className="uw-sr-only">{t('uwPickLoading')}</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <span className="uw-skel uw-skel-line" key={i} aria-hidden="true" />
          ))}
        </div>
      )}
      {load.status === 'error' && (
        <div className="uw-info-error" role="alert">
          <p>{t(UNIWORK_ERROR_KEYS[load.error])}</p>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            {t('acctRetry')}
          </button>
        </div>
      )}
      {load.status === 'ready' && (
        <dl className="uw-info-list">
          {docInfoRows(load.info, t, dateLocale).map((row) => (
            <div className="uw-info-row" key={row.labelKey}>
              <dt>{t(row.labelKey)}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
