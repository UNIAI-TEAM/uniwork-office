import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  ShareAccessRequest,
  ShareRequestLevel,
  UniworkShareApi,
} from '../../../shared/share-api'
import { useI18n } from '../locale'
import { levelLabel as levelText } from './share-model'
import { useAccessRequests } from './use-share'

export interface AccessRequestsSectionProps {
  api: UniworkShareApi
  documentId: string
  /** opened from the inbox link: the heading takes focus */
  focusOnOpen?: boolean
  /** an approval created a grant: the dialog reloads the access list */
  onDecided: (changedAccess: boolean) => Promise<void>
}

// low to high: an approval may keep the level that was asked, go lower or go higher, up to edit
// and never to manage (that is the access list's job); "comment" is offered only to a request
// that asked for it
const LEVEL_ORDER: readonly ShareRequestLevel[] = ['view', 'comment', 'edit']

function askedLevel(value: string): ShareRequestLevel {
  return LEVEL_ORDER.find((level) => level === value) ?? 'view'
}

type Notice =
  | { kind: 'approved'; name: string; level: ShareRequestLevel }
  | { kind: 'declined'; name: string }
  | { kind: 'closed' }

/**
 * "Access requests (n)": the people who administer the document see who asked for what, why and
 * from where, and approve or decline. Both are permission changes, so each waits for the server:
 * the row stays until the answer is in, and a closed request (handled by someone else, expired,
 * archived) says so and reloads the list.
 */
export function AccessRequestsSection({
  api,
  documentId,
  focusOnOpen = false,
  onDecided,
}: AccessRequestsSectionProps) {
  const { t, dateLocale } = useI18n()
  const titleId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const requests = useAccessRequests(api, documentId, true)
  const [choices, setChoices] = useState<Record<string, ShareRequestLevel>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<{ id: string; action: 'approve' | 'decline' } | null>(null)
  // the row the decision came from and the one after it: once the list has dropped the decided
  // row, focus goes to the next row, else the heading
  const [handoff, setHandoff] = useState<{ decidedId: string; nextId: string | null } | null>(null)

  useEffect(() => {
    if (!focusOnOpen) return
    const focus = () => {
      headingRef.current?.focus()
      headingRef.current?.scrollIntoView?.({ block: 'nearest' })
    }
    focus()
    const frame = requestAnimationFrame(focus)
    return () => cancelAnimationFrame(frame)
  }, [focusOnOpen])

  const rows = useMemo(() => requests.data ?? [], [requests.data])

  useEffect(() => {
    if (!handoff || busyId) return
    if (requests.status === 'error') {
      headingRef.current?.focus()
      setHandoff(null)
      return
    }
    if (requests.status !== 'ready') return
    if (rows.some((row) => row.id === handoff.decidedId)) return
    const next = handoff.nextId
      ? listRef.current?.querySelector<HTMLElement>(`[data-request-id="${handoff.nextId}"]`)
      : null
    ;(next?.querySelector<HTMLElement>('button') ?? headingRef.current)?.focus()
    setHandoff(null)
  }, [handoff, busyId, requests.status, rows])

  const nameOf = (row: ShareAccessRequest) => row.requesterName.trim() || t('shrPersonUnknown')
  // "comment" has this section's own label
  const levelName = (level: string) =>
    level === 'comment' ? t('shrReqLevelComment') : levelText(t, level)

  const closed = (row: ShareAccessRequest) => {
    const at = rows.findIndex((r) => r.id === row.id)
    setHandoff({ decidedId: row.id, nextId: rows[at + 1]?.id ?? null })
  }

  const decide = async (row: ShareAccessRequest, action: 'approve' | 'decline') => {
    if (busyId) return
    setNotice(null)
    setError(false)
    setBusyId({ id: row.id, action })
    const name = nameOf(row)
    const level = choices[row.id] ?? askedLevel(row.requestedLevel)
    const result =
      action === 'approve'
        ? await api.requestApprove({ documentId, requestId: row.id, level })
        : await api.requestDecline({ documentId, requestId: row.id })
    if (!result.ok) {
      if (result.error === 'access_request_closed') {
        setNotice({ kind: 'closed' })
        closed(row)
        await requests.refetch()
      } else {
        // the server's own text is never shown: it may not be in the viewer's language
        setError(true)
      }
      setBusyId(null)
      return
    }
    setNotice(action === 'approve' ? { kind: 'approved', name, level } : { kind: 'declined', name })
    closed(row)
    await requests.refetch()
    await onDecided(action === 'approve')
    setBusyId(null)
  }

  // null: the server has no access-requests route, so there is nothing to show (or retry)
  if (requests.data === null) return null

  return (
    <section
      aria-labelledby={titleId}
      className="uw-share-section flush"
      data-share-section="requests"
    >
      <div className="uw-share-section-head ruled">
        <h3 id={titleId} ref={headingRef} tabIndex={-1} className="uw-share-heading">
          {t('shrReqSectionTitle', { count: requests.status === 'ready' ? rows.length : '…' })}
        </h3>
      </div>
      <p role="status" className={notice ? 'uw-share-notice' : 'uw-share-sr'}>
        {notice?.kind === 'approved'
          ? t('shrReqApproved', { name: notice.name, level: levelName(notice.level) })
          : notice?.kind === 'declined'
            ? t('shrReqDeclined', { name: notice.name })
            : notice?.kind === 'closed'
              ? t('shrReqClosed')
              : ''}
      </p>
      {error && (
        <p role="alert" className="uw-act-error uw-share-pad">
          {t('shrReqDecisionFailed')}
        </p>
      )}
      {requests.status === 'loading' || requests.status === 'idle' ? (
        <div className="uw-share-pad" aria-busy="true">
          <span aria-hidden="true" className="uw-share-skeleton wide" />
        </div>
      ) : requests.status === 'error' && rows.length === 0 ? (
        <div className="uw-share-pad uw-share-row-line">
          <p role="alert" className="uw-act-error">
            {t('shrError')}
          </p>
          <button type="button" className="btn" onClick={() => void requests.refetch()}>
            {t('shrRetry')}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="uw-share-muted uw-share-pad">{t('shrReqNonePending')}</p>
      ) : (
        <ul ref={listRef} className="uw-share-list">
          {rows.map((row) => {
            const asked = askedLevel(row.requestedLevel)
            const choice = choices[row.id] ?? asked
            const options = LEVEL_ORDER.filter(
              (level) => level !== 'comment' || asked === 'comment',
            )
            const name = nameOf(row)
            const rowBusy = busyId?.id === row.id ? busyId.action : null
            const created = new Date(row.createdAt)
            return (
              <li
                key={row.id}
                data-request-id={row.id}
                aria-labelledby={`${titleId}-${row.id}`}
                className="uw-share-row stacked request"
              >
                <div className="uw-share-row-line">
                  <span
                    id={`${titleId}-${row.id}`}
                    className="uw-share-row-name strong"
                    title={name}
                  >
                    {name}
                  </span>
                  <time
                    dateTime={row.createdAt}
                    className="uw-share-muted"
                    title={
                      Number.isNaN(created.getTime())
                        ? undefined
                        : new Intl.DateTimeFormat(dateLocale, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(created)
                    }
                  >
                    {Number.isNaN(created.getTime())
                      ? ''
                      : new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium' }).format(
                          created,
                        )}
                  </time>
                </div>
                <p className="uw-share-muted">
                  <span>{levelName(asked)}</span>
                  {' · '}
                  <span>
                    {row.source?.title
                      ? t('shrReqRowSource', { source: row.source.title })
                      : t('shrReqRowSourceUnknown')}
                  </span>
                </p>
                {row.message && <p className="uw-share-message">{row.message}</p>}
                <div className="uw-share-row-controls wrap">
                  <select
                    className="uw-act-select uw-share-level-select"
                    aria-label={t('shrLevelFor', { name })}
                    value={choice}
                    onChange={(e) =>
                      setChoices((prev) => ({ ...prev, [row.id]: askedLevel(e.target.value) }))
                    }
                  >
                    {options.map((value) => (
                      <option key={value} value={value}>
                        {levelName(value)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary"
                    aria-disabled={busyId !== null || undefined}
                    aria-busy={rowBusy === 'approve' || undefined}
                    onClick={() => void decide(row, 'approve')}
                  >
                    {t('shrReqApprove')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    aria-disabled={busyId !== null || undefined}
                    aria-busy={rowBusy === 'decline' || undefined}
                    onClick={() => void decide(row, 'decline')}
                  >
                    {t('shrReqDecline')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
