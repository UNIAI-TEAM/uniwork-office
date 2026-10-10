import { useI18n } from '../i18n/locale'
import { AppOnlyNote } from './AppOnlyNote'
import { useModalKeys } from './modal-keys'

/**
 * Blocking "use the app" dialog of the web frame: a document that cannot be opened here (a
 * password-protected .docx) says so with the shared hint and the Open-in-app action, instead of a
 * raw parse error. OK or Escape closes it; the editor stays on the blank document.
 */
export function AppOnlyDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const { t } = useI18n()
  const modalKeys = useModalKeys(onClose)
  return (
    <div className="modal-backdrop" ref={modalKeys.ref} onKeyDown={modalKeys.onKeyDown}>
      <div className="modal gs-form" role="dialog" aria-modal="true">
        <h2>{t('appDocPwdTitle')}</h2>
        <AppOnlyNote
          testId="docs-encrypted-app-only"
          lead="appOnlyEncrypted"
          leadParams={{ name }}
          feature="docs.encrypted"
        />
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('appOk')}
          </button>
        </div>
      </div>
    </div>
  )
}
