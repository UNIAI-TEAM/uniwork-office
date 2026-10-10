import { useI18n } from '../i18n/locale'
import { cap } from '../capabilities'

/**
 * One inline note above the web preview (chrome, never inside the document): the page uses
 * network requests or nested frames, which the web preview blocks, and the same page works in the
 * UniWork Office app. The action shows only while the host grants `desktopOpen`; an `unavailable`
 * outcome means the host already told the user why, so nothing more is shown here.
 */
export function PreviewLimitNote() {
  const { t } = useI18n()
  const canOpen = cap('desktopOpen')
  return (
    <div className="preview-limit-note" role="note">
      <span className="preview-limit-text">
        {t('previewLimitNote')} {t('useInAppMessage')}
      </span>
      {canOpen && (
        <button
          type="button"
          className="preview-limit-action"
          onClick={() => void window.htmlApi.openInDesktopApp?.('html.preview')}
        >
          {t('openInApp')}
        </button>
      )}
    </div>
  )
}
