import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/locale'

interface Props {
  onApply: (href: string) => void
  onCancel: () => void
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])
const HOST_WITH_PORT = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+):\d+(?:[/?#]|$)/i

/**
 * The href to write for what the user typed, or null when it must not become a
 * link (a script-bearing scheme such as javascript: or data:). A bare address
 * like `example.com` gets https://; `#anchor`, `/path` and `./file` stay as typed.
 */
export function normalizeLinkHref(raw: string): string | null {
  const value = raw.trim()
  if (!value || /\s/.test(value)) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]
  if (scheme && SAFE_SCHEMES.has(scheme.toLowerCase())) return value
  // `localhost:3000/x` and `example.com:8080` are addresses with a port, not a scheme (a bare
  // word before the colon, such as `javascript:1`, stays a scheme)
  if (scheme && !HOST_WITH_PORT.test(value)) return null
  if (/^[#/.?]/.test(value)) return value
  return `https://${value}`
}

/**
 * Ctrl/Cmd+K on a text selection in the preview: one field for the link address.
 * Enter wraps the selection in an <a href>, Esc (or leaving the field) cancels.
 */
export function LinkPopover({ onApply, onCancel }: Props) {
  const { t } = useI18n()
  const [href, setHref] = useState('')
  const [refused, setRefused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  return (
    <div
      className="ai-ask-pop link-pop"
      role="dialog"
      aria-label={t('insertLink')}
      style={{ top: 96, left: '50%', width: 340, transform: 'translateX(-50%)' }}
    >
      <div className="ai-ask-pop-title">{t('insertLink')}</div>
      <input
        ref={inputRef}
        className="ai-ask-pop-input"
        type="url"
        value={href}
        placeholder={t('linkPlaceholder')}
        aria-label={t('linkPlaceholder')}
        aria-invalid={refused}
        aria-describedby={refused ? 'link-pop-invalid' : undefined}
        onChange={(e) => {
          setHref(e.target.value)
          setRefused(false)
        }}
        onBlur={onCancel}
        onKeyDown={(e) => {
          // an IME composition owns Enter and Esc
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const safe = normalizeLinkHref(href)
            if (safe) onApply(safe)
            else setRefused(true)
          }
        }}
      />
      {refused && (
        <div id="link-pop-invalid" className="link-pop-invalid" role="alert">
          {t('linkInvalid')}
        </div>
      )}
    </div>
  )
}
