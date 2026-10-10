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
  // The frame dialog family (web/modules/shared/frame-dialog.css, bundled with the web frame, which
  // is the only place this note shows): blur scrim, close X, filled primary, token colours. Open in
  // app is the primary when the host offers it; otherwise Close is the one action and fills.
  const canOpen = canOpenInApp()
  return (
    <div className="ow-dlg-mask" onClick={onClose}>
      <div
        className="ow-dlg"
        data-use-app="dialog"
        {...dialogProps}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ow-dlg-head">
          <h2 className="ow-dlg-title" id={titleId}>
            {t('appUseAppTitle')}
          </h2>
          <p className="ow-dlg-body">{t('appUseAppMessage')}</p>
        </div>
        <div className="ow-dlg-actions">
          {canOpen && (
            <button
              type="button"
              className="ow-dlg-btn primary"
              disabled={busy}
              onClick={() => void open()}
            >
              {t('appUseAppAction')}
            </button>
          )}
          <button
            type="button"
            className={canOpen ? 'ow-dlg-btn ghost' : 'ow-dlg-btn primary'}
            onClick={onClose}
          >
            {t('appUseAppClose')}
          </button>
        </div>
        <button
          type="button"
          className="ow-dlg-close"
          aria-label={t('appUseAppClose')}
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <path
              d="M3 3l8 8M11 3l-8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
