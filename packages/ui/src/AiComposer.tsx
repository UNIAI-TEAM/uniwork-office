import React, { useEffect, useRef } from 'react'
import type { Lang } from '@genoffice/i18n'
import { IconEnter, IconSend, IconStop } from './icons'
import { useAiPanelPrefs } from './ai-panel-prefs-store'
import { useAiModelNeedAction, useAiModelNeedHint } from './ai-model-need'
import type { AiComposerUniworkProps } from './ai-uniwork-composer'

// Keep in sync with the CSS `max-height` on `.ai-input-box textarea` (7 lines à 24px)
const MAX_TEXTAREA_HEIGHT = 168

export interface AiComposerProps {
  readonly value: string
  readonly busy: boolean
  readonly placeholder: string
  readonly hintIdle: string
  readonly hintBusy: string
  readonly hintIdleTitle?: string | undefined
  readonly sendLabel: string
  readonly stopLabel: string
  readonly ariaLabel?: string | undefined
  /** content inside the box above the textarea (attachment chips, …) — Genspark composer style */
  readonly header?: React.ReactNode
  /** extra controls at the left of the footer (attach button, toggles, …) */
  readonly footerStart?: React.ReactNode
  /** compact variant: no hint text, icon-only enter/stop button (Genspark composer style) */
  readonly iconOnly?: boolean | undefined
  /** custom art for the icon-only send button (e.g. brand-supplied PNGs); falls back to IconEnter */
  readonly sendIconEnabled?: React.ReactNode
  readonly sendIconDisabled?: React.ReactNode
  /** custom art for the icon-only stop button while busy; falls back to IconStop */
  readonly stopIcon?: React.ReactNode
  /** pass a ref to focus the textarea from outside */
  readonly textareaRef?: React.RefObject<HTMLTextAreaElement | null> | undefined
  readonly onChange: (next: string) => void
  readonly onSend: () => void
  readonly onStop: () => void
  /** clipboard files pasted into the textarea (screenshots, copied files); text paste stays native */
  readonly onPasteFiles?: ((files: File[]) => void) | undefined
  /** first look at pasted text; return true to consume it (e.g. a base64 image turned into an attachment) */
  readonly onPasteText?: ((text: string) => boolean) | undefined
  /** S7–S10 UniWork AI composer configuration (note, disclosure, view-only, Send/Stop labels) */
  readonly uniwork?: AiComposerUniworkProps | undefined
  /** Top-level shorthand for `uniwork.viewOnly`: renders `aiUniworkViewOnly` sub-line under the composer */
  readonly viewOnly?: boolean | undefined
  /** Top-level shorthand for `uniwork.popupOpen`: guards `Escape` from stopping while a popup is open */
  readonly popupOpen?: boolean | undefined
  /** UI language for `ai-uniwork` copy (default `'vi'`) */
  readonly lang?: Lang | undefined
}

/**
 * The AI panel input box shared by docs and sheets: auto-growing textarea
 * (Enter sends, Shift+Enter newline, Esc stops) plus a footer with optional
 * app-specific controls, a shortcut hint, and the send/stop button.
 * Renders the `.ai-input-box` class family; each app themes it in its own CSS.
 */
export function AiComposer({
  value,
  busy,
  placeholder,
  hintIdle,
  hintBusy,
  hintIdleTitle,
  sendLabel,
  stopLabel,
  ariaLabel,
  header,
  footerStart,
  iconOnly = false,
  sendIconEnabled,
  sendIconDisabled,
  stopIcon,
  textareaRef,
  onChange,
  onSend,
  onStop,
  onPasteFiles,
  onPasteText,
}: AiComposerProps): React.JSX.Element {
  const innerRef = useRef<HTMLTextAreaElement | null>(null)
  const ref = textareaRef ?? innerRef
  // no key or no known model (web): send stays off and the hint says why
  const needModelHint = useAiModelNeedHint()
  const needModelAction = useAiModelNeedAction()
  const canSend = value.trim().length > 0 && !busy && needModelHint === null
  const { spellcheck } = useAiPanelPrefs()

  // auto-grow up to ~6 lines; empty clears the inline height outright so the
  // CSS min-height governs (a hidden-at-measure pass can leave a stale value).
  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    if (value === '') {
      ta.style.height = ''
      return
    }
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value, ref])

  return (
    <div className="ai-input-box">
      {header}
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={1}
        dir="auto"
        spellCheck={spellcheck}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (canSend) onSend()
          } else if (e.key === 'Escape' && busy) {
            e.preventDefault()
            onStop()
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files)
          if (files.length > 0) {
            if (!onPasteFiles) return
            e.preventDefault()
            onPasteFiles(files)
            return
          }
          const text = e.clipboardData.getData('text/plain')
          if (text && onPasteText?.(text)) e.preventDefault()
        }}
      />
      {iconOnly && needModelHint !== null && !busy && (
        // the icon-only footer has no room for the hint line: it sits above it, and opens the AI settings
        <div className="ai-input-need" role="status">
          {needModelAction ? (
            <button type="button" className="ai-input-need-link" onClick={needModelAction}>
              {needModelHint}
            </button>
          ) : (
            needModelHint
          )}
        </div>
      )}
      <div className="ai-input-footer">
        {footerStart}
        {!iconOnly && (
          <span className="ai-input-hint" title={busy ? undefined : hintIdleTitle}>
            {busy ? hintBusy : (needModelHint ?? hintIdle)}
          </span>
        )}
        {busy ? (
          <button
            className="ai-send-btn ai-stop-btn"
            onClick={onStop}
            title={stopLabel}
            aria-label={stopLabel}
          >
            {iconOnly ? (stopIcon ?? <IconStop size={16} />) : <IconStop size={16} />}
            {!iconOnly && stopLabel}
          </button>
        ) : (
          <button
            className="ai-send-btn"
            onClick={onSend}
            disabled={!canSend}
            title={needModelHint ?? sendLabel}
            aria-label={sendLabel}
          >
            {iconOnly ? (
              ((canSend ? sendIconEnabled : (sendIconDisabled ?? sendIconEnabled)) ?? (
                <IconEnter size={16} />
              ))
            ) : (
              <IconSend size={16} />
            )}
            {!iconOnly && sendLabel}
          </button>
        )}
      </div>
    </div>
  )
}
