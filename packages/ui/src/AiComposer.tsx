import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { IconEnter, IconSend, IconStop } from './icons'
import { useAiPanelPrefs } from './ai-panel-prefs-store'
import { useAiModelNeedAction, useAiModelNeedHint } from './ai-model-need'
import {
  UniworkComposerNote,
  UniworkDisclosure,
  UniworkDisclosureShort,
  isComposerPopupOpen,
  useUniworkDisclosureAck,
  type AiComposerUniworkProps,
} from './ai-uniwork-composer'
import { aiUniworkText } from './strings-ai-uniwork'

// Keep in sync with the CSS `max-height` on `.ai-input-box textarea` (7 lines à 24px)
const MAX_TEXTAREA_HEIGHT = 168

export interface AiComposerProps {
  readonly value: string
  readonly busy: boolean
  readonly placeholder: string
  readonly hintIdle?: string | undefined
  readonly hintBusy?: string | undefined
  readonly hintIdleTitle?: string | undefined
  readonly sendLabel: string
  readonly stopLabel: string
  readonly ariaLabel?: string | undefined
  /** content inside the box above the textarea (attachment chips, …) — Genspark composer style */
  readonly header?: React.ReactNode
  /** queued-messages strip, rendered above the header while replies run */
  readonly queueStrip?: React.ReactNode
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
  /** while busy, Enter queues the draft instead of sending (MiniMax-style queue) */
  readonly onQueue?: (() => void) | undefined
  /** placeholder shown while busy and queueing is available, naming the Enter/Esc swap */
  readonly queuePlaceholder?: string | undefined
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
 * While busy, Enter queues the draft instead (see useChatRunQueue).
 */
export function AiComposer({
  value,
  busy,
  placeholder,
  hintIdle = '',
  hintBusy = '',
  hintIdleTitle,
  sendLabel,
  stopLabel,
  ariaLabel,
  header,
  queueStrip,
  footerStart,
  iconOnly = false,
  sendIconEnabled,
  sendIconDisabled,
  stopIcon,
  textareaRef,
  onChange,
  onSend,
  onQueue,
  queuePlaceholder,
  onStop,
  onPasteFiles,
  onPasteText,
  uniwork,
  viewOnly,
  popupOpen,
  lang,
}: AiComposerProps): React.JSX.Element {
  const innerRef = useRef<HTMLTextAreaElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const internalDisclosureRegionRef = useRef<HTMLElement | null>(null)
  const ref = textareaRef ?? innerRef
  const autoId = useId()
  const autoSentenceId = `ai-uniwork-disclosure-sentence-${autoId}`
  const autoNeedsAckId = `ai-uniwork-send-needs-ack-${autoId}`

  // no key or no known model (web): send stays off and the hint says why
  const needModelHint = useAiModelNeedHint()
  const needModelAction = useAiModelNeedAction()
  const { spellcheck } = useAiPanelPrefs()

  const hasUniworkFeatures = uniwork !== undefined || viewOnly !== undefined
  const uniworkActive = Boolean(
    uniwork &&
    (uniwork.active ?? (uniwork.provider === undefined || uniwork.provider === 'uniwork')),
  )
  const resolvedLang: Lang = uniwork?.lang ?? lang ?? 'vi'
  const resolvedViewOnly = Boolean(viewOnly ?? uniwork?.viewOnly)
  const resolvedPopupOpen = Boolean(popupOpen ?? uniwork?.popupOpen)

  const disclosureCfg = uniworkActive ? uniwork?.disclosure : undefined
  const { acked, acknowledge: acknowledgeDisclosure } = useUniworkDisclosureAck(
    disclosureCfg?.ackKey,
  )
  const unacked = Boolean(
    disclosureCfg && (disclosureCfg.needsAck ?? (disclosureCfg.ackKey ? !acked : false)),
  )
  const renderInlineDisclosure = Boolean(disclosureCfg && (disclosureCfg.renderInline ?? true))
  const sentenceId = disclosureCfg?.sentenceId ?? autoSentenceId

  const canSend = value.trim().length > 0 && !busy && needModelHint === null && !unacked

  // the panel's queue honours the same disclosure gate as Send: a held message must not reach
  // UniWork AI before the user has acknowledged the disclosure
  const onSendBlockedChange = uniwork?.onSendBlockedChange
  useEffect(() => {
    if (!onSendBlockedChange) return undefined
    onSendBlockedChange(unacked)
    return () => onSendBlockedChange(false)
  }, [onSendBlockedChange, unacked])

  const [liveText, setLiveText] = useState('')
  const onAnnounceProp = uniwork?.onAnnounce
  const announce = useCallback(
    (text: string) => {
      setLiveText(text)
      onAnnounceProp?.(text)
    },
    [onAnnounceProp],
  )

  const prevBusyRef = useRef(busy)
  useEffect(() => {
    if (prevBusyRef.current !== busy) {
      prevBusyRef.current = busy
      if (uniworkActive && busy) {
        announce(aiUniworkText(resolvedLang, 'aiRunRunning'))
      }
    }
  }, [busy, uniworkActive, resolvedLang, announce])

  const handleStop = useCallback(() => {
    if (uniworkActive) {
      announce(aiUniworkText(resolvedLang, 'aiRunStopped'))
    }
    onStop()
  }, [uniworkActive, announce, resolvedLang, onStop])

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

  // the disclosure region owns its own ack hook; an ack that cannot be stored (empty account)
  // lives in this composer's hook, so it has to be recorded here too
  const disclosureOnAck = disclosureCfg?.onAck
  const handleDisclosureAck = useCallback(() => {
    acknowledgeDisclosure()
    disclosureOnAck?.()
  }, [acknowledgeDisclosure, disclosureOnAck])

  const handleBlockedByAck = useCallback(() => {
    announce(aiUniworkText(resolvedLang, 'aiUniworkSendNeedsAck'))
    const regionNode = disclosureCfg?.regionRef?.current ?? internalDisclosureRegionRef.current
    regionNode?.focus()
    disclosureCfg?.onRequestFocus?.()
  }, [announce, resolvedLang, disclosureCfg])

  const effectiveSendLabel = uniworkActive
    ? aiUniworkText(resolvedLang, uniwork?.sendLabelKey ?? 'aiRunSend')
    : sendLabel
  const effectiveStopLabel = uniworkActive
    ? aiUniworkText(resolvedLang, uniwork?.stopLabelKey ?? 'aiRunStop')
    : stopLabel

  const inputBox = (
    <div ref={boxRef} className="ai-input-box">
      {queueStrip}
      {header}
      <textarea
        ref={ref}
        className="ai-input"
        value={value}
        placeholder={busy && onQueue && queuePlaceholder ? queuePlaceholder : placeholder}
        aria-label={ariaLabel}
        rows={1}
        dir="auto"
        spellCheck={spellcheck}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (unacked) {
              handleBlockedByAck()
              return
            }
            if (canSend) onSend()
            else if (busy && onQueue) onQueue()
          } else if (e.key === 'Escape' && busy) {
            if (resolvedPopupOpen || isComposerPopupOpen(boxRef.current)) return
            e.preventDefault()
            handleStop()
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
            onClick={handleStop}
            title={effectiveStopLabel}
            aria-label={effectiveStopLabel}
          >
            {iconOnly ? (stopIcon ?? <IconStop size={16} />) : <IconStop size={16} />}
            {!iconOnly && effectiveStopLabel}
          </button>
        ) : (
          <button
            className="ai-send-btn"
            onClick={unacked ? handleBlockedByAck : onSend}
            disabled={!unacked && !canSend}
            aria-disabled={unacked ? 'true' : undefined}
            aria-describedby={unacked ? `${autoNeedsAckId} ${sentenceId}` : undefined}
            title={needModelHint ?? effectiveSendLabel}
            aria-label={effectiveSendLabel}
          >
            {iconOnly ? (
              ((canSend ? sendIconEnabled : (sendIconDisabled ?? sendIconEnabled)) ?? (
                <IconEnter size={16} />
              ))
            ) : (
              <IconSend size={16} />
            )}
            {!iconOnly && effectiveSendLabel}
          </button>
        )}
      </div>
    </div>
  )

  if (!hasUniworkFeatures) {
    return inputBox
  }

  return (
    <>
      {!onAnnounceProp && (
        <div className="ai-uniwork-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {liveText}
        </div>
      )}
      {unacked && (
        <span id={autoNeedsAckId} className="ai-uniwork-sr-only">
          {aiUniworkText(resolvedLang, 'aiUniworkSendNeedsAck')}
        </span>
      )}
      {uniwork && (
        <UniworkComposerNote
          note={uniwork.note}
          lang={resolvedLang}
          provider={uniwork.provider ?? (uniworkActive ? 'uniwork' : 'other')}
          onAction={uniwork.onNoteAction}
          onChooseProvider={uniwork.onChooseProvider}
          onChooseOtherProvider={uniwork.onChooseOtherProvider}
          onSignIn={uniwork.onSignIn}
          onAnnounce={announce}
        />
      )}
      {renderInlineDisclosure && unacked && disclosureCfg && (
        <UniworkDisclosure
          ackKey={disclosureCfg.ackKey}
          needsAck={disclosureCfg.needsAck}
          orgName={disclosureCfg.orgName}
          variant={disclosureCfg.variant}
          lang={resolvedLang}
          sentenceId={sentenceId}
          regionRef={disclosureCfg.regionRef ?? internalDisclosureRegionRef}
          onAck={handleDisclosureAck}
          onLearnMore={disclosureCfg.onLearnMore}
          onAnnounce={announce}
        />
      )}
      {inputBox}
      {renderInlineDisclosure && !unacked && disclosureCfg && (
        <UniworkDisclosureShort
          orgName={disclosureCfg.orgName}
          variant={disclosureCfg.variant}
          lang={resolvedLang}
        />
      )}
      {resolvedViewOnly && (
        <div className="ai-uniwork-view-only">
          {aiUniworkText(resolvedLang, 'aiUniworkViewOnly')}
        </div>
      )}
    </>
  )
}
