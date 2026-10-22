import { useEffect, useId, useRef, useState } from 'react'
import {
  BREAK_GLASS_REASON_MAX,
  BREAK_GLASS_REASON_MIN,
  type ShareBreakGlassGrant,
  type UniworkShareApi,
} from '../../../shared/share-api'
import { useI18n } from '../locale'
import { formatWhen } from './share-model'

type Problem = 'failed' | 'tooShort' | 'tooLong' | 'revokeFailed'

/** the reason as the server counts it: trimmed, in code points (an emoji is one) */
const reasonLength = (value: string) => Array.from(value.trim()).length

/**
 * Emergency access: a workspace admin opens a 24 h read-only grant on a restricted document with
 * a written reason (10-500 characters), and ends it early with Revoke. The grants are listed to
 * the document's managers and to the administering admin; only the admin can open or end one.
 */
export function ShareBreakGlassSection({
  api,
  documentId,
  grants,
  resolveName,
  canGrant,
  focusOnOpen = false,
  onMutated,
}: {
  api: UniworkShareApi
  documentId: string
  grants: readonly ShareBreakGlassGrant[]
  /** null while the directory is still loading: the row then falls back to a neutral label */
  resolveName: (userId: string) => string | null
  /** the administering admin: the reason form and Revoke */
  canGrant: boolean
  /** opened from a notice: the heading takes focus and scrolls into view */
  focusOnOpen?: boolean
  /** a grant was opened or ended: the dialog reloads the access overview */
  onMutated: (note: string) => Promise<void>
}) {
  const { t, dateLocale } = useI18n()
  const reasonId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)

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
  const hintId = useId()
  const problemId = useId()
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const count = reasonLength(reason)
  const live: Problem | null =
    count === 0
      ? null
      : count < BREAK_GLASS_REASON_MIN
        ? 'tooShort'
        : count > BREAK_GLASS_REASON_MAX
          ? 'tooLong'
          : null
  const shown = live ?? problem
  const actorName = (grant: ShareBreakGlassGrant) =>
    grant.actorName || resolveName(grant.actorId) || t('shrPersonUnknown')
  const problemText = (kind: Problem) =>
    kind === 'tooShort'
      ? t('shrBgReasonTooShort')
      : kind === 'tooLong'
        ? t('shrBgReasonTooLong')
        : kind === 'revokeFailed'
          ? t('shrBgRevokeFailed')
          : t('shrBgSubmitFailed')

  const submit = async () => {
    if (submitting || count < BREAK_GLASS_REASON_MIN || count > BREAK_GLASS_REASON_MAX) return
    setSubmitting(true)
    setProblem(null)
    const result = await api
      .breakGlassGrant({ documentId, reason: reason.trim() })
      .catch((): { ok: false; error: 'network' } => ({ ok: false, error: 'network' }))
    if (!result.ok) {
      // the server's own verdict on the length reads in the person's language, not as its text
      setProblem(
        result.error === 'break_glass_reason_invalid'
          ? count > BREAK_GLASS_REASON_MAX
            ? 'tooLong'
            : 'tooShort'
          : 'failed',
      )
      setSubmitting(false)
      return
    }
    setReason('')
    await onMutated('')
    setSubmitting(false)
  }

  const revoke = async (grantId: string) => {
    if (revokingId) return
    setRevokingId(grantId)
    setProblem(null)
    const result = await api
      .breakGlassRevoke({ documentId, grantId })
      .catch((): { ok: false; error: 'network' } => ({ ok: false, error: 'network' }))
    if (!result.ok) {
      setProblem('revokeFailed')
      setRevokingId(null)
      return
    }
    await onMutated('')
    setRevokingId(null)
  }

  return (
    <section
      aria-labelledby="share-break-glass-title"
      data-share-section="break-glass"
      className="uw-share-section warn flush"
    >
      <div className="uw-share-section-head ruled">
        <svg
          className="uw-share-icon"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 1.8l5.5 10.7h-11z" />
          <path d="M8 6.2v3M8 11.2v.1" />
        </svg>
        <h3
          id="share-break-glass-title"
          ref={headingRef}
          tabIndex={-1}
          className="uw-share-heading"
        >
          {t('shrBgAccessPanelSection')}
        </h3>
      </div>
      {canGrant && (
        <div className="uw-share-pad uw-share-reason-form">
          <label htmlFor={reasonId} className="uw-act-label">
            {t('shrBgReasonLabel')}
          </label>
          <textarea
            id={reasonId}
            className="uw-share-reason"
            rows={3}
            value={reason}
            aria-invalid={shown === 'tooShort' || shown === 'tooLong' || undefined}
            aria-describedby={`${hintId}${shown ? ` ${problemId}` : ''}`}
            disabled={submitting}
            onChange={(e) => {
              setReason(e.target.value)
              setProblem(null)
            }}
          />
          <div className="uw-share-row-line">
            <span id={hintId} className="uw-share-muted">
              {t('shrBgReasonHint')}
            </span>
            <span className="uw-share-muted">{t('shrBgReasonCounter', { count })}</span>
          </div>
          {shown && (
            <p id={problemId} role={live ? undefined : 'alert'} className="uw-act-error">
              {problemText(shown)}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            aria-disabled={submitting || live !== null || count === 0 || undefined}
            aria-busy={submitting || undefined}
            onClick={() => void submit()}
          >
            {t('shrBgConfirmButton')}
          </button>
        </div>
      )}
      {grants.length === 0 ? (
        <p className="uw-share-muted uw-share-pad">{t('shrBgNoActiveGrants')}</p>
      ) : (
        <ul className="uw-share-list">
          {grants.map((grant) => (
            <li key={grant.id} className="uw-share-row" data-break-glass-id={grant.id}>
              <span className="uw-share-row-name wrap">
                {t('shrBgAccessPanelRow', {
                  name: actorName(grant),
                  time: formatWhen(grant.expiresAt, dateLocale),
                  reason: grant.reason,
                })}
              </span>
              {canGrant && (
                <button
                  type="button"
                  className="btn uw-share-revoke"
                  disabled={revokingId !== null}
                  aria-label={`${t('shrBgRevokeButton')} ${actorName(grant)}`}
                  onClick={() => void revoke(grant.id)}
                >
                  {t('shrBgRevokeButton')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
