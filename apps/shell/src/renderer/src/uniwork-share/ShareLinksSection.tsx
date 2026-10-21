import { useEffect, useRef, useState } from 'react'
import type { ShareLink, UniworkShareApi } from '../../../shared/share-api'
import { useI18n } from '../locale'
import { formatWhen, linkErrorKey, plural } from './share-model'

export interface ShareLinksSectionProps {
  api: UniworkShareApi
  documentId: string
  links: readonly ShareLink[]
  /** the organization's public-links policy when the account may read it (read only here) */
  publicLinksEnabled?: boolean
  /** a shelved document: links can be revoked, not created */
  locked: boolean
  lockedNoteId?: string
  onMutated: (note: string) => Promise<void>
}

/**
 * The public-links half of the dialog. A minted link's raw URL exists here once and only once:
 * the list below holds metadata (created, expiry, views) and never rebuilds a token. The server's
 * refusals are named individually (the live-link limit, the organization switch, the plan) so the
 * reader knows which action is theirs. Revoking is immediate; a lost URL means creating another.
 */
export function ShareLinksSection({
  api,
  documentId,
  links,
  publicLinksEnabled,
  locked,
  lockedNoteId,
  onMutated,
}: ShareLinksSectionProps) {
  const { t, dateLocale } = useI18n()
  const [expiry, setExpiry] = useState('7')
  const [created, setCreated] = useState<{ url: string } | null>(null)
  const [createError, setCreateError] = useState<{ text: string; switchedOff: boolean } | null>(
    null,
  )
  const [revokeError, setRevokeError] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<'create' | string | null>(null)
  const copyRef = useRef<HTMLButtonElement>(null)

  // the raw URL is shown once: bring it into view and put focus on its copy action
  useEffect(() => {
    if (!created) return
    copyRef.current?.scrollIntoView?.({ block: 'nearest' })
    copyRef.current?.focus()
  }, [created])

  const now = Date.now()

  const submitCreate = async () => {
    if (busy || locked) return
    setBusy('create')
    setCreateError(null)
    setCopied(false)
    const days = Number.parseInt(expiry, 10)
    const result = await api.linkCreate({
      documentId,
      ...(Number.isFinite(days) ? { expiresInDays: Math.min(90, Math.max(1, days)) } : {}),
    })
    if (!result.ok) {
      setBusy(null)
      setCreateError({
        text: t(linkErrorKey(result.error) ?? 'shrLinkCreateFailed'),
        switchedOff: result.error === 'document_links_disabled',
      })
      return
    }
    setCreated({ url: result.value.url })
    await onMutated('')
    setBusy(null)
  }

  const revoke = async (link: ShareLink) => {
    if (busy) return
    setBusy(link.id)
    setRevokeError(false)
    const result = await api.linkRevoke({ documentId, linkId: link.id })
    if (!result.ok) setRevokeError(true)
    else await onMutated('')
    setBusy(null)
  }

  const copy = () => {
    if (!created) return
    void navigator.clipboard?.writeText(created.url).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  return (
    <section
      aria-labelledby="share-links-title"
      className="uw-share-section"
      data-share-section="links"
    >
      <div className="uw-share-section-head">
        <h3 id="share-links-title" className="uw-share-heading">
          {t('shrLinksTitle')}
        </h3>
        <span className="uw-share-muted">{t('shrLinksDescription')}</span>
      </div>
      <p className="uw-share-muted" data-share-policy>
        {publicLinksEnabled === false || createError?.switchedOff
          ? t('shrLinksPolicyDisabled')
          : t('shrLinksPolicyEnabled')}
      </p>

      {created && (
        <div className="uw-share-created">
          <p className="uw-share-heading">{t('shrLinkCreatedTitle')}</p>
          <p className="uw-share-url" data-testid="share-created-url">
            {created.url}
          </p>
          <p className="uw-share-muted">{t('shrLinkUrlOnce')}</p>
          <div>
            <button ref={copyRef} type="button" className="btn btn-primary" onClick={copy}>
              {copied ? t('shrLinkCopied') : t('shrLinkCopy')}
            </button>
          </div>
        </div>
      )}

      <div className="uw-share-form-row">
        <div className="uw-share-form-left">
          <div className="uw-share-field narrow">
            <label className="uw-act-label" htmlFor="share-link-expiry">
              {t('shrLinkExpiryLabel')}
            </label>
            <input
              id="share-link-expiry"
              className="uw-act-input"
              type="number"
              min={1}
              max={90}
              value={expiry}
              disabled={busy === 'create' || locked}
              onChange={(event) => setExpiry(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy === 'create'}
            aria-disabled={locked || undefined}
            aria-describedby={locked ? lockedNoteId : undefined}
            aria-busy={busy === 'create' || undefined}
            onClick={() => void submitCreate()}
          >
            {busy === 'create' ? t('shrSubmitting') : t('shrLinkCreate')}
          </button>
        </div>
        <p className="uw-share-muted uw-share-hint">{t('shrLinkLostHint')}</p>
      </div>

      {createError && (
        <p role="alert" className="uw-act-error">
          {createError.text}
        </p>
      )}
      {revokeError && (
        <p role="alert" className="uw-act-error">
          {t('shrRevokeFailed')}
        </p>
      )}

      {links.length === 0 ? (
        <p className="uw-share-muted">{t('shrLinksEmpty')}</p>
      ) : (
        <ul className="uw-share-list bordered">
          {links.map((link) => {
            const expiresAt = link.expiresAt ? new Date(link.expiresAt) : null
            const expired = expiresAt !== null && expiresAt.getTime() <= now
            const createdAt = formatWhen(link.createdAt, dateLocale)
            return (
              <li key={link.id} className="uw-share-row" data-link-id={link.id}>
                <span className="uw-share-row-text">
                  <span className="uw-share-row-main">
                    {createdAt}
                    {expired && <span className="uw-share-muted">{t('shrLinkExpiredBadge')}</span>}
                  </span>
                  <span className="uw-share-row-sub">
                    {expiresAt
                      ? t('shrLinkExpiresAt', { time: formatWhen(link.expiresAt, dateLocale) })
                      : t('shrLinkNoExpiry')}
                    {` · ${plural(t, 'shrLinkViews', link.viewCount)}`}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn uw-share-revoke"
                  aria-label={`${t('shrLinkRevoke')} ${createdAt}`}
                  disabled={busy !== null}
                  aria-busy={busy === link.id || undefined}
                  onClick={() => void revoke(link)}
                >
                  {t('shrLinkRevoke')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
