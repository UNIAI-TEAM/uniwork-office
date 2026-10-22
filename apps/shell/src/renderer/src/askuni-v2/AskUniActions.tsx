import { useEffect, useId, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useI18n, type StringKey } from '../locale'
import { bridgeFeedback, type AskUniFeedbackApi } from './bridge'
import {
  ASKUNI_MAX_FEEDBACK_NOTE,
  type AskUniCitation,
  type AskUniFeedbackRating,
  type AskUniFeedbackReason,
  type AskUniFeedbackRequest,
} from '../../../shared/askuni-api'
import './askuni-v2.css'

const REASONS: { reason: AskUniFeedbackReason; key: StringKey }[] = [
  { reason: 'wrong_facts', key: 'askUniV2ReasonWrongFacts' },
  { reason: 'missing_sources', key: 'askUniV2ReasonMissingSources' },
  { reason: 'not_helpful', key: 'askUniV2ReasonNotHelpful' },
  { reason: 'other', key: 'askUniV2ReasonOther' },
]
const COPIED_MS = 1500
const CITE_TOKEN = /(\s?)\[S(\d+)\]/gi

/**
 * The answer as plain text for the clipboard: a `[Sn]` marker that matches a source becomes that
 * source's title, one that matches none (and means nothing outside the panel) is dropped.
 */
export function answerPlainText(content: string, citations: AskUniCitation[]): string {
  const byN = new Map<string, AskUniCitation>()
  for (const c of citations) byN.set(c.sourceId.toUpperCase(), c)
  return content.replace(CITE_TOKEN, (_all, space: string, n: string) => {
    const c = byN.get(`S${n}`)
    return c ? `${space}[${c.title || c.kind}]` : ''
  })
}

// The server never returns a rating, so it is kept for the session: the bar is rebuilt when a live
// turn becomes a stored one, and must still show what the user pressed.
const ratings = new Map<string, AskUniFeedbackRating>()

/** forgets every rating of this session (sign-out, account switch, tests) */
export function clearAskUniRatings(): void {
  ratings.clear()
}

function Icon({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const COPY_ICON = (
  <Icon>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-1A1.5 1.5 0 0 0 9 3H4.5A1.5 1.5 0 0 0 3 4.5V9a1.5 1.5 0 0 0 1.5 1.5h1" />
  </Icon>
)
const CHECK_ICON = (
  <Icon>
    <path d="m3.5 8.5 3 3 6-6.5" />
  </Icon>
)
const REGENERATE_ICON = (
  <Icon>
    <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
  </Icon>
)
const UP_ICON = (
  <Icon>
    <path d="M5.5 7v6.5h-2V7zM5.5 7l2.2-4.2a1.3 1.3 0 0 1 2.4.8L9.8 6h2.7a1.3 1.3 0 0 1 1.3 1.6l-.9 4.4a1.7 1.7 0 0 1-1.7 1.4H5.5" />
  </Icon>
)
const DOWN_ICON = (
  <Icon>
    <path d="M5.5 9V2.5h-2V9zM5.5 9l2.2 4.2a1.3 1.3 0 0 0 2.4-.8L9.8 10h2.7a1.3 1.3 0 0 0 1.3-1.6l-.9-4.4a1.7 1.7 0 0 0-1.7-1.4H5.5" />
  </Icon>
)

function ActionButton(props: {
  label: string
  pressed?: boolean
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
  buttonRef?: React.Ref<HTMLButtonElement>
}): ReactElement {
  return (
    <button
      ref={props.buttonRef}
      type="button"
      className="askuni-v2-action"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      aria-disabled={props.disabled || undefined}
      onClick={props.disabled ? undefined : props.onClick}
    >
      {props.children}
    </button>
  )
}

function DownFeedback(props: {
  active: boolean
  onSend: (reason: AskUniFeedbackReason | '', note: string) => void
}): ReactElement {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<AskUniFeedbackReason | ''>('')
  const [note, setNote] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const group = useId()
  const titleId = useId()

  useEffect(() => {
    if (open) dialogRef.current?.querySelector<HTMLElement>('input, textarea')?.focus()
  }, [open])

  // a click anywhere else closes it, like the web popover
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  return (
    <div className="askuni-v2-feedback" ref={wrapRef}>
      <ActionButton
        buttonRef={triggerRef}
        label={t('askUniV2NotRight')}
        pressed={props.active}
        onClick={() => setOpen((o) => !o)}
      >
        {DOWN_ICON}
      </ActionButton>
      {open ? (
        <div
          ref={dialogRef}
          className="askuni-v2-card askuni-v2-feedback-card"
          role="dialog"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close(true)
            }
          }}
        >
          <p id={titleId} className="askuni-v2-card-title">
            {t('askUniV2FeedbackTitle')}
          </p>
          <div role="radiogroup" aria-labelledby={titleId} className="askuni-v2-reasons">
            {REASONS.map((r) => (
              <label key={r.reason} className="askuni-v2-reason">
                <input
                  type="radio"
                  name={group}
                  value={r.reason}
                  checked={reason === r.reason}
                  onChange={() => setReason(r.reason)}
                />
                {t(r.key)}
              </label>
            ))}
          </div>
          <label className="askuni-v2-note-field">
            <span>{t('askUniV2NoteLabel')}</span>
            <textarea
              value={note}
              rows={3}
              maxLength={ASKUNI_MAX_FEEDBACK_NOTE}
              placeholder={t('askUniV2NotePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
            <span className="askuni-v2-note-count">
              {t('askUniV2NoteCount', {
                count: String(note.length),
                max: String(ASKUNI_MAX_FEEDBACK_NOTE),
              })}
            </span>
          </label>
          <button
            type="button"
            className="askuni-v2-send-feedback"
            onClick={() => {
              props.onSend(reason, note.trim())
              close(true)
            }}
          >
            {t('askUniV2SendFeedback')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Copy, regenerate (last answer only) and 👍/👎 under one finished answer. An answer with no text
 * (stopped before any, or nothing found) has no copy and no rating, only regenerate.
 */
export function AskUniActions(props: {
  conversationId: string
  messageId: string
  content: string
  citations: AskUniCitation[]
  onRegenerate?: () => void
  regenerateDisabled?: boolean
  /** defaults to the bridge's feedback calls */
  feedback?: AskUniFeedbackApi
}): ReactElement | null {
  const { t } = useI18n()
  const { conversationId, messageId } = props
  const api = props.feedback ?? bridgeFeedback
  const [copied, setCopied] = useState(false)
  const [, bump] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const key = `${conversationId}:${messageId}`
  const rating = ratings.get(key) ?? null
  const setRating = (next: AskUniFeedbackRating | null) => {
    if (next) ratings.set(key, next)
    else ratings.delete(key)
    bump((n) => n + 1)
  }

  const hasText = props.content.trim() !== ''
  if (!hasText && !props.onRegenerate) return null

  const copy = async () => {
    try {
      // no clipboard (or a denied one) leaves the button unchanged
      await navigator.clipboard.writeText(answerPlainText(props.content, props.citations))
    } catch {
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }

  // optimistic: the button flips at once and goes back when the server refuses
  const send = (next: AskUniFeedbackRating | null, call: () => Promise<{ ok: boolean }>): void => {
    const before = rating
    setRating(next)
    const revert = () => setRating(before)
    call().then((res) => {
      if (!res.ok) revert()
    }, revert)
  }

  const up = () => {
    if (rating === 'up') {
      send(null, () => api.clear({ conversationId, messageId }))
      return
    }
    send('up', () => api.set({ conversationId, messageId, rating: 'up' }))
  }
  const down = (reason: AskUniFeedbackReason | '', note: string) => {
    const req: AskUniFeedbackRequest = {
      conversationId,
      messageId,
      rating: 'down',
      ...(reason ? { reason } : {}),
      ...(note ? { note } : {}),
    }
    send('down', () => api.set(req))
  }

  return (
    <div className="askuni-v2-actions">
      {hasText ? (
        <ActionButton
          label={copied ? t('askUniV2Copied') : t('askUniV2Copy')}
          onClick={() => void copy()}
        >
          {copied ? CHECK_ICON : COPY_ICON}
        </ActionButton>
      ) : null}
      {props.onRegenerate ? (
        <ActionButton
          label={t('askUniV2Regenerate')}
          disabled={props.regenerateDisabled}
          onClick={props.onRegenerate}
        >
          {REGENERATE_ICON}
        </ActionButton>
      ) : null}
      {hasText ? (
        <>
          <ActionButton label={t('askUniV2Helpful')} pressed={rating === 'up'} onClick={up}>
            {UP_ICON}
          </ActionButton>
          <DownFeedback active={rating === 'down'} onSend={down} />
        </>
      ) : null}
    </div>
  )
}
