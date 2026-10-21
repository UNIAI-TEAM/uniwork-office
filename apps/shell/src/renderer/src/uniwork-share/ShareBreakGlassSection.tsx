import type { ShareBreakGlassGrant } from '../../../shared/share-api'
import { useI18n } from '../locale'
import { formatWhen } from './share-model'

/**
 * Emergency access a workspace admin opened on a restricted document, as the overview lists it
 * (to the document's managers and to the administering admin only). Read only here: the bridge
 * has no break-glass route yet, so a grant is listed and runs out, it is not revoked from the app.
 */
export function ShareBreakGlassSection({
  grants,
  resolveName,
}: {
  grants: readonly ShareBreakGlassGrant[]
  /** null while the directory is still loading: the row then falls back to a neutral label */
  resolveName: (userId: string) => string | null
}) {
  const { t, dateLocale } = useI18n()
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
        <h3 id="share-break-glass-title" className="uw-share-heading">
          {t('shrBgAccessPanelSection')}
        </h3>
      </div>
      {grants.length === 0 ? (
        <p className="uw-share-muted uw-share-pad">{t('shrBgNoActiveGrants')}</p>
      ) : (
        <ul className="uw-share-list">
          {grants.map((grant) => (
            <li key={grant.id} className="uw-share-row" data-break-glass-id={grant.id}>
              <span className="uw-share-row-name wrap">
                {t('shrBgAccessPanelRow', {
                  name: grant.actorName || resolveName(grant.actorId) || t('shrPersonUnknown'),
                  time: formatWhen(grant.expiresAt, dateLocale),
                  reason: grant.reason,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
