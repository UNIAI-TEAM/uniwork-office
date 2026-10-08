import { useEffect, useState, type ReactElement } from 'react'
import QRCode from 'qrcode'
import type { Lang } from '@genoffice/i18n'

/** Production/staging host for the standalone uniAI PWA. */
export const UNIAI_PWA_URL = 'https://uniwork.app/app'

function L(lang: Lang, vi: string, en: string): string {
  return lang === 'vi' ? vi : en
}

interface Props {
  lang: Lang
}

export function UniAiPwaPane({ lang }: Props): ReactElement {
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  useEffect(() => {
    let cancelled = false
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
      <h3 className="set-pane-title">{L(lang, 'uniAI (PWA)', 'uniAI (PWA)')}</h3>
      <p className="set-backup-lead">
        {L(
          lang,
          'Ứng dụng AI độc lập kiểu chat — đăng nhập UniWork / Token Hub trên web. Không bắt buộc cài Desktop Office.',
          'Standalone ChatGPT-style AI app — sign in to UniWork / Token Hub on the web. Desktop Office is optional.',
        )}
      </p>

      <div className="set-uniai-hero">
        <div className="set-uniai-qr-block">
          {qrDataUrl ? (
            <img
              className="set-uniai-qr"
              src={qrDataUrl}
              width={160}
              height={160}
              alt={L(lang, 'Mã QR mở uniAI', 'QR code to open uniAI')}
            />
          ) : (
            <div className="set-uniai-qr set-uniai-qr-placeholder" aria-hidden="true" />
          )}
          <div>
            <strong>uniAI</strong>
            <span className="set-uniai-url">{UNIAI_PWA_URL}</span>
            <p className="set-uniai-qr-hint">
              {L(
                lang,
                'Quét mã QR bằng điện thoại để mở / cài uniAI.',
                'Scan this QR code with your phone to open or install uniAI.',
              )}
            </p>
          </div>
        </div>
        <button type="button" className="set-btn primary" onClick={openPwa}>
          {L(lang, 'Mở & cài uniAI', 'Open & install uniAI')}
        </button>
      </div>

      <h4 className="set-backup-h">{L(lang, 'Cách cài trên máy', 'How to install on your device')}</h4>
      <ol className="set-uniai-steps">
        <li>
          {L(
            lang,
            'Quét QR ở trên, hoặc nhấn “Mở & cài uniAI” trên máy này.',
            'Scan the QR above, or click “Open & install uniAI” on this device.',
          )}
        </li>
        <li>
          <strong>Windows / Chrome hoặc Edge:</strong>{' '}
          {L(
            lang,
            'menu ⋮ hoặc biểu tượng Install trên thanh địa chỉ → “Cài đặt uniAI” / “Install app”.',
            'menu ⋮ or the Install icon in the address bar → “Install uniAI” / “Install app”.',
          )}
        </li>
        <li>
          <strong>macOS / Chrome hoặc Edge:</strong>{' '}
          {L(
            lang,
            'biểu tượng Install trên thanh địa chỉ, hoặc File → “Install uniAI…”.',
            'Install icon in the address bar, or File → “Install uniAI…”.',
          )}
        </li>
        <li>
          <strong>Safari (macOS / iOS):</strong>{' '}
          {L(
            lang,
            'Nút Share → “Add to Dock” / “Add to Home Screen”.',
            'Share → “Add to Dock” / “Add to Home Screen”.',
          )}
        </li>
      </ol>

      <h4 className="set-backup-h">{L(lang, 'Dùng độc lập', 'Works standalone')}</h4>
      <ul className="set-uniai-bullets">
        <li>
          {L(
            lang,
            'Chat + lịch sử trên trình duyệt / app đã cài; Token Hub trừ token trên UniWork.',
            'Chat + history in the browser / installed app; Token Hub bills on UniWork.',
          )}
        </li>
        <li>
          {L(
            lang,
            'Không cần UniWork Office để chat. Office chỉ cần khi muốn lệnh NL mở tab Workbench trên máy.',
            'UniWork Office is not required for chat. Office is only needed when NL commands should open Workbench tabs on-device.',
          )}
        </li>
      </ul>
    </div>
  )
}
