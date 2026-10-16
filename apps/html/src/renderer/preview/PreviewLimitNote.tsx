import { useI18n } from '../i18n/locale'
import { cap, platform } from '../capabilities'

/**
 * One inline note above the preview (chrome, never inside the document): the page uses network
 * requests or nested frames, which the preview blocks.
 *
 * Web frame: the web preview blocks them and the same page works in the UniWork Office app, so
 * the note says that and offers the action while the host grants `desktopOpen`; an `unavailable`
 * outcome means the host already told the user why, so nothing more is shown here.
 *
 * Desktop: the app's own preview blocks them too (html-preview:// policy), so the note only says
 * so: there is no other app to open the page in.
 */
export function PreviewLimitNote() {
  const { t } = useI18n()
  const web = platform() === 'web'
  const canOpen = web && cap('desktopOpen')
  return (
    <div className="preview-limit-note" role="note">
      <span className="preview-limit-text">
        {web ? `${t('previewLimitNote')} ${t('useInAppMessage')}` : t('previewLimitNoteApp')}
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
