import { useEffect, useState, type ReactElement } from 'react'
import QRCode from 'qrcode'
import { useI18n } from './locale'

/** Production/staging host for the standalone UniAI PWA. */
export const UNIAI_PWA_URL = 'https://uniworkos.com/app'

export function UniAiPwaPane(): ReactElement {
  const { t } = useI18n()
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    // the QR stays dark-on-white in both themes: phone cameras need the contrast
    void QRCode.toDataURL(UNIAI_PWA_URL, {
      width: 200,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const openPwa = () => {
    window.open(UNIAI_PWA_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="set-uniai">
      <h3 className="set-pane-title">{t('uaiTitle')}</h3>
      <p className="set-backup-lead">{t('uaiLead')}</p>

      <div className="set-uniai-hero">
        <div className="set-uniai-qr-block">
          {qrDataUrl ? (
            <img
              className="set-uniai-qr"
              src={qrDataUrl}
              width={160}
              height={160}
              alt={t('uaiQrAlt')}
            />
          ) : (
            <div className="set-uniai-qr set-uniai-qr-placeholder" aria-hidden="true" />
          )}
          <div>
            <strong>UniAI</strong>
            <span className="set-uniai-url">{UNIAI_PWA_URL}</span>
            <p className="set-uniai-qr-hint">{t('uaiQrHint')}</p>
          </div>
        </div>
        <button type="button" className="set-btn primary" onClick={openPwa}>
          {t('uaiOpen')}
        </button>
      </div>

      <h4 className="set-pane-subtitle">{t('uaiInstallHeading')}</h4>
      <ol className="set-uniai-steps">
        <li>{t('uaiStepScan')}</li>
        <li>
          <strong>{t('uaiStepWinLabel')}</strong> {t('uaiStepWin')}
        </li>
        <li>
          <strong>{t('uaiStepMacLabel')}</strong> {t('uaiStepMac')}
        </li>
        <li>
          <strong>{t('uaiStepSafariLabel')}</strong> {t('uaiStepSafari')}
        </li>
      </ol>

      <h4 className="set-pane-subtitle">{t('uaiStandaloneHeading')}</h4>
      <ul className="set-uniai-bullets">
        <li>{t('uaiStandalone1')}</li>
        <li>{t('uaiStandalone2')}</li>
      </ul>
    </div>
  )
}
