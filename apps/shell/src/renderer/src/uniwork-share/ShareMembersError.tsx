import { useI18n } from '../locale'
import type { ShareDirectoryError } from './use-share'

/**
 * The one line the dialog shows when the member walk did not finish. It carries `role="alert"`,
 * so a screen reader hears it once when it appears. The page-bound case has no Retry: another try
 * would walk the same pages and stop at the same place.
 */
export function ShareMembersError({
  error,
  onRetry,
}: {
  error: ShareDirectoryError
  onRetry: () => void
}) {
  const { t } = useI18n()
  const text =
    error === 'first'
      ? t('shrMembersErrorFirst')
      : error === 'partial'
        ? t('shrMembersErrorPartial')
        : t('shrMembersErrorLimit')
  return (
    <div className="uw-share-note error" role="alert" data-share-members-error>
      <span>{text}</span>
      {error !== 'limit' && (
        <button type="button" className="btn" onClick={onRetry}>
          {t('shrRetry')}
        </button>
      )}
    </div>
  )
}
