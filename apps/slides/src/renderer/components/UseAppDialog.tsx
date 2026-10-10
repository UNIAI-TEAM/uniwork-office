/**
 * Modal "use the app" note of the web frame: the message and, when the host grants it, the
 * Open-in-app action (see ../use-app.ts). Shown for features the web does not offer (a user
 * action opened it, so a dialog is fine).
 */
import { useState } from 'react'
import { useModalDialog } from './modal-dialog'
import { useI18n } from '../i18n/locale'
import { canOpenInApp, openInApp } from '../use-app'

export function UseAppDialog({ feature, onClose }: { feature: string; onClose: () => void }) {
  const { titleId, dialogProps } = useModalDialog(onClose)
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    const handled = await openInApp(feature)
    setBusy(false)
    if (handled) onClose()
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal use-app-modal"
        data-use-app="dialog"
        {...dialogProps}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{t('appUseAppTitle')}</h2>
        <p className="use-app-message">{t('appUseAppMessage')}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{t('appUseAppClose')}</button>
          {canOpenInApp() && (
            <button className="primary" disabled={busy} onClick={() => void open()}>
              {t('appUseAppAction')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
