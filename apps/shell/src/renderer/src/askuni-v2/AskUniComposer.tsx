import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ClipboardEvent, ReactElement } from 'react'
import { IconSend, IconStop } from '@genoffice/ui'
import { useI18n, type StringKey } from '../locale'
import {
  ASKUNI_MAX_MENTIONS,
  type AskUniFocusKind,
  type AskUniLocale,
  type AskUniObjectRef,
  type AskUniMentionKind,
} from '../../../shared/askuni-api'
import { AskUniMentionPicker, type MentionPick } from './AskUniMentionPicker'
import { AskUniModelPicker } from './AskUniModelPicker'
import { AskUniScopePicker } from './AskUniScopePicker'
import type { AskUniModelSelection } from './model-choice'

const MAX_QUESTION = 2000
/** the counter only shows near the cap, so a short question stays uncluttered */
const COUNTER_FROM = 1800
const TRIGGER = /(^|\s)@([^\s@]*)$/

const KIND_KEYS: Record<string, StringKey> = {
  task: 'askUniV2KindTask',
  meeting: 'askUniV2KindMeeting',
  document: 'askUniV2KindDocument',
  project: 'askUniV2KindProject',
  room: 'askUniV2KindRoom',
  email_thread: 'askUniV2KindEmail',
}

/** what the composer hands over on send; the panel adds conversation, model, effort */
export interface AskUniComposerInput {
  question: string
  locale: AskUniLocale
  focus?: AskUniObjectRef<AskUniFocusKind>
  mentions?: AskUniObjectRef<AskUniMentionKind>[]
}

export interface AskUniComposerProps {
  workspaceId: string
  /** a newly chosen conversation puts the caret in the box */
  conversationId?: string
  streaming: boolean
  selection: AskUniModelSelection
  /** an entry point's focus (the document tab) that becomes the chip once */
  pendingFocus?: { kind: AskUniFocusKind; id: string; label?: string }
  onPendingFocusConsumed?: () => void
  onSend: (input: AskUniComposerInput) => void
  onStop: () => void
}

interface Focus {
  kind: AskUniFocusKind
  id: string
  label: string
}

/** the `@query` the caret sits in, if any; `start` is the index of its `@` */
function findTrigger(text: string, caret: number): { start: number; query: string } | null {
  const m = TRIGGER.exec(text.slice(0, caret))
  return m ? { start: m.index + (m[1]?.length ?? 0), query: m[2] ?? '' } : null
}

function Chip({
  kind,
  label,
  remove,
  onRemove,
}: {
  kind: 'focus' | 'mention'
  label: string
  remove: string
  onRemove: () => void
}): ReactElement {
  return (
    <span className="askuni2-chip" data-chip={kind}>
      <span className="askuni2-chip-text">{label}</span>
      <button type="button" className="askuni2-chip-x" aria-label={remove} onClick={onRemove}>
        <svg
          viewBox="0 0 16 16"
          width="10"
          height="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </span>
  )
}

/**
 * Ask UNI composer (web P2): Enter sends, Shift+Enter breaks the line, an IME's Enter never sends,
 * paste is plain text, 2000 characters. Row: "+" scope left; model pick and Send/Stop right.
 * The box is disabled while a turn streams (only Stop works) and focus follows that.
 */
export function AskUniComposer({
  workspaceId,
  conversationId,
  streaming,
  selection,
  pendingFocus,
  onPendingFocusConsumed,
  onSend,
  onStop,
}: AskUniComposerProps): ReactElement {
  const { t, lang } = useI18n()
  const box = useRef<HTMLTextAreaElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const wasStreaming = useRef(streaming)
  const nextCaret = useRef<number | null>(null)
  const [value, setValue] = useState('')
  const [caret, setCaret] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [mentions, setMentions] = useState<MentionPick[]>([])
  const [focus, setFocus] = useState<Focus | null>(null)
  const [notice, setNotice] = useState('')

  const trigger = findTrigger(value, caret)
  const pickerOpen = !streaming && trigger !== null && trigger.start !== dismissedAt
  const kindLabel = (kind: string): string => {
    const key = KIND_KEYS[kind]
    return key ? t(key) : kind
  }

  // a chosen conversation puts the caret in the box
  useEffect(() => {
    if (!streaming) box.current?.focus()
    // only a different conversation moves focus, not a streaming flip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // the box is disabled while a turn streams: focus moves to Stop, and comes back when it ends unless
  // the reader has put it somewhere else meanwhile
  useEffect(() => {
    if (streaming && !wasStreaming.current) {
      stopRef.current?.focus()
    } else if (!streaming && wasStreaming.current) {
      const active = document.activeElement
      if (!active || active === document.body || active === stopRef.current) box.current?.focus()
    }
    wasStreaming.current = streaming
  }, [streaming])

  // an entry point's focus becomes the chip once
  const consumedRef = useRef(onPendingFocusConsumed)
  consumedRef.current = onPendingFocusConsumed
  useEffect(() => {
    if (!pendingFocus) return
    const kind = kindLabel(pendingFocus.kind)
    setFocus({
      kind: pendingFocus.kind,
      id: pendingFocus.id,
      label: pendingFocus.label ? `${kind}: ${pendingFocus.label}` : kind,
    })
    consumedRef.current?.()
    box.current?.focus()
    // kindLabel only reads the language, which a pending focus does not outlive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocus])

  // after a pick the caret belongs after the inserted name
  useLayoutEffect(() => {
    if (nextCaret.current === null || !box.current) return
    box.current.setSelectionRange(nextCaret.current, nextCaret.current)
    nextCaret.current = null
  })

  const pick = (p: MentionPick) => {
    if (!trigger) return
    if (!mentions.some((m) => m.kind === p.kind && m.id === p.id)) {
      if (mentions.length >= ASKUNI_MAX_MENTIONS) {
        setNotice(t('askUniV2MentionLimit', { max: String(ASKUNI_MAX_MENTIONS) }))
        setDismissedAt(trigger.start)
        return
      }
      setMentions([...mentions, p])
    }
    setNotice('')
    const insert = `@${p.label} `
    setValue((value.slice(0, trigger.start) + insert + value.slice(caret)).slice(0, MAX_QUESTION))
    nextCaret.current = Math.min(MAX_QUESTION, trigger.start + insert.length)
    setCaret(nextCaret.current)
    box.current?.focus()
  }

  const send = () => {
    const question = value.trim()
    if (!question || streaming) return
    onSend({
      question,
      locale: lang === 'vi' ? 'vi' : 'en',
      ...(focus ? { focus: { kind: focus.kind, id: focus.id } } : {}),
      ...(mentions.length > 0 ? { mentions: mentions.map(({ kind, id }) => ({ kind, id })) } : {}),
    })
    setValue('')
    setCaret(0)
    // the next question may start with an @ again
    setDismissedAt(null)
    setMentions([])
    setNotice('')
  }

  // plain text only, at the caret, within the cap
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const el = e.currentTarget
    const from = el.selectionStart
    const to = el.selectionEnd
    const room = MAX_QUESTION - (value.length - (to - from))
    if (room <= 0) return
    const piece = text.slice(0, room)
    setValue(value.slice(0, from) + piece + value.slice(to))
    nextCaret.current = from + piece.length
    setCaret(nextCaret.current)
  }

  const canSend = value.trim() !== ''
  return (
    <footer className="askuni2-composer" data-slot="askuni-composer">
      <div className="askuni2-composer-box">
        {pickerOpen && trigger ? (
          <AskUniMentionPicker
            workspaceId={workspaceId}
            query={trigger.query}
            listId={listId}
            inputRef={box}
            onPick={pick}
            onDismiss={() => setDismissedAt(trigger.start)}
          />
        ) : null}
        {focus || mentions.length > 0 ? (
          <div className="askuni2-chips">
            {focus ? (
              <Chip
                kind="focus"
                label={focus.label}
                remove={t('askUniV2ScopeRemove', { name: focus.label })}
                onRemove={() => {
                  setFocus(null)
                  box.current?.focus()
                }}
              />
            ) : null}
            {mentions.map((m) => (
              <Chip
                key={`${m.kind}:${m.id}`}
                kind="mention"
                label={m.label}
                remove={t('askUniV2MentionRemove', { name: m.label })}
                onRemove={() => {
                  setMentions((all) => all.filter((x) => x !== m))
                  box.current?.focus()
                }}
              />
            ))}
          </div>
        ) : null}
        {notice ? (
          <p role="alert" className="askuni2-notice-error">
            {notice}
          </p>
        ) : null}
        <textarea
          ref={box}
          rows={1}
          value={value}
          maxLength={MAX_QUESTION}
          disabled={streaming}
          aria-label={t('askUniV2ComposerLabel')}
          placeholder={t('askUniPlaceholder')}
          {...(pickerOpen
            ? {
                role: 'combobox',
                'aria-expanded': true,
                'aria-haspopup': 'listbox' as const,
                'aria-controls': listId,
                'aria-autocomplete': 'list' as const,
              }
            : {})}
          onChange={(e) => {
            const next = findTrigger(e.target.value, e.target.selectionStart)
            if (next?.start !== dismissedAt) setDismissedAt(null)
            setValue(e.target.value)
            setCaret(e.target.selectionStart)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
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
          <AskUniScopePicker
            workspaceId={workspaceId}
            finalFocus={box}
            disabled={streaming}
            onPick={(p) =>
              setFocus({ kind: p.kind, id: p.id, label: `${kindLabel(p.kind)}: ${p.title}` })
            }
          />
          <span className="askuni2-composer-end">
            {value.length >= COUNTER_FROM ? (
              <span className="askuni-counter">
                {t('askUniCounter', { used: String(value.length), max: String(MAX_QUESTION) })}
              </span>
            ) : null}
            <AskUniModelPicker selection={selection} disabled={streaming} />
            {streaming ? (
              <button
                // distinct keys: the Send button must not reuse the focused Stop node
                key="stop"
                ref={stopRef}
                type="button"
                className="new-chat-send is-stop"
                onClick={onStop}
                title={t('askUniStop')}
                aria-label={t('askUniStop')}
              >
                <IconStop size={14} />
              </button>
            ) : (
              <button
                key="send"
                type="button"
                className="new-chat-send"
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
