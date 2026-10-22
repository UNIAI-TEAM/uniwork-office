import { useEffect, useLayoutEffect, useRef } from 'react'
import type {
  ClipboardEvent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  RefObject,
  TextareaHTMLAttributes,
} from 'react'
import { IconSend, IconStop } from '../icons'
import { useAskUniAdapter } from './adapter'
import './ask-uni.css'

/** the question cap of the server, enforced here so a paste cannot exceed it either */
export const ASKUNI_MAX_QUESTION = 2000
/** the counter only shows near the cap, so a short question stays uncluttered */
export const ASKUNI_COUNTER_FROM = 1800
/** a key press that lands on Stop this soon after a send is the tail of the Enter that sent */
const STOP_GUARD_MS = 300

export interface AskUniComposerBoxProps {
  /** the host owns the text (it also owns pickers, chips and what a send hands over) */
  value: string
  /** the box's text changed (typing or paste); `caret` is where the cursor now is */
  onValueChange: (value: string, caret: number) => void
  onCaretChange?: (caret: number) => void
  /** Enter or the Send button on a non-blank box while no turn runs; the host reads its own value */
  onSend: () => void
  onStop: () => void
  /** the box is disabled while a turn streams (only Stop works) and focus follows that */
  streaming: boolean
  /** defaults to the shared composer label / placeholder */
  label?: string
  placeholder?: string
  inputRef?: RefObject<HTMLTextAreaElement | null>
  /** a host that sets the caret after its own edit (a mention pick) writes it here */
  nextCaretRef?: MutableRefObject<number | null>
  /** role / aria-* of a combobox, or anything else the host's picker needs on the textarea */
  textareaProps?: TextareaHTMLAttributes<HTMLTextAreaElement>
  /** inside the box, above the text: pickers, chips, notices */
  above?: ReactNode
  /** left of the row under the text (a scope button) */
  rowStart?: ReactNode
  /** right side of the row, before Send (a model picker) */
  rowEnd?: ReactNode
  /** replaces the default look of the Send / Stop button (Home styles its own) */
  sendClassName?: string
  /** data-slot of the footer, for the host's tests and styles */
  slot?: string
}

/**
 * The plain Ask UNI composer: Enter sends, Shift+Enter breaks the line, an IME's Enter never sends,
 * paste is plain text at the caret, 2000 characters with a counter near the cap, Send and Stop.
 * It holds no text of its own and knows nothing of workspaces, models or mentions: Home plugs those
 * in through the slots, an editor uses it bare.
 */
export function AskUniComposerBox(props: AskUniComposerBoxProps): ReactElement {
  const { t } = useAskUniAdapter()
  const {
    value,
    onValueChange,
    onCaretChange,
    onSend,
    onStop,
    streaming,
    sendClassName = 'askuni-v2-send',
  } = props
  const ownBox = useRef<HTMLTextAreaElement>(null)
  const box = props.inputRef ?? ownBox
  const stopRef = useRef<HTMLButtonElement>(null)
  const ownCaret = useRef<number | null>(null)
  const nextCaret = props.nextCaretRef ?? ownCaret
  const wasStreaming = useRef(streaming)
  const stopFocusedAt = useRef(0)

  // the box is disabled while a turn streams: focus moves to Stop, and comes back when it ends unless
  // the reader has put it somewhere else meanwhile
  useEffect(() => {
    if (streaming && !wasStreaming.current) {
      stopFocusedAt.current = Date.now()
      stopRef.current?.focus()
    } else if (!streaming && wasStreaming.current) {
      const active = document.activeElement
      if (!active || active === document.body || active === stopRef.current) box.current?.focus()
    }
    wasStreaming.current = streaming
  }, [streaming, box])

  // after an edit the host (or a paste) made, the caret belongs where it says
  useLayoutEffect(() => {
    if (nextCaret.current === null || !box.current) return
    box.current.setSelectionRange(nextCaret.current, nextCaret.current)
    nextCaret.current = null
  })

  const canSend = value.trim() !== ''
  const send = () => {
    if (canSend && !streaming) onSend()
  }

  // plain text only, at the caret, within the cap
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const el = e.currentTarget
    const from = el.selectionStart
    const to = el.selectionEnd
    const room = ASKUNI_MAX_QUESTION - (value.length - (to - from))
    if (room <= 0) return
    const piece = text.slice(0, room)
    nextCaret.current = from + piece.length
    onValueChange(value.slice(0, from) + piece + value.slice(to), nextCaret.current)
  }

  return (
    <footer className="askuni2-composer" data-slot={props.slot}>
      <div className="askuni2-composer-box">
        {props.above}
        <textarea
          ref={box}
          rows={1}
          value={value}
          maxLength={ASKUNI_MAX_QUESTION}
          disabled={streaming}
          aria-label={props.label ?? t('askUniV2ComposerLabel')}
          placeholder={props.placeholder ?? t('askUniPlaceholder')}
          {...props.textareaProps}
          onChange={(e) => onValueChange(e.target.value, e.target.selectionStart)}
          onSelect={(e) => onCaretChange?.(e.currentTarget.selectionStart)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            // an IME commits its syllable on Enter; that keydown must not send
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229)
              return
            e.preventDefault()
            send()
          }}
        />
        <div className="askuni2-composer-row">
          {props.rowStart ?? <span />}
          <span className="askuni2-composer-end">
            {value.length >= ASKUNI_COUNTER_FROM ? (
              <span className="askuni-counter">
                {t('askUniCounter', {
                  used: String(value.length),
                  max: String(ASKUNI_MAX_QUESTION),
                })}
              </span>
            ) : null}
            {props.rowEnd}
            {streaming ? (
              <button
                // distinct keys: the Send button must not reuse the focused Stop node
                key="stop"
                ref={stopRef}
                type="button"
                className={`${sendClassName} is-stop`}
                onKeyDown={(e) => {
                  // a held Enter repeats keydown; each repeat would click Stop again once the 300 ms are over
                  if (e.repeat) e.preventDefault()
                }}
                onClick={(e) => {
                  // a key repeat or a second Enter right after the send must not stop the new turn
                  // (a pointer click has detail >= 1 and is never held back)
                  if (e.detail === 0 && Date.now() - stopFocusedAt.current < STOP_GUARD_MS) return
                  onStop()
                }}
                title={t('askUniStop')}
                aria-label={t('askUniStop')}
              >
                <IconStop size={14} />
              </button>
            ) : (
              <button
                key="send"
                type="button"
                className={sendClassName}
                disabled={!canSend}
                onClick={send}
                title={t('askUniSend')}
                aria-label={t('askUniSend')}
              >
                <IconSend size={16} />
              </button>
            )}
          </span>
        </div>
      </div>
    </footer>
  )
}
