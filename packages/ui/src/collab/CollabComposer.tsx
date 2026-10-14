/**
 * Textarea composer for comments, replies, edits and discussion posts (S12/S13)
 * with the S14 mention picker. Label = placeholder (edit: a hidden label);
 * Ctrl/Cmd+Enter sends; Esc closes the picker first, then cancels (a draft asks
 * first). The draft survives a reload and is cleared only after the server
 * accepted the text. The box shows a picked person as `@Name` (tinted by a mirror
 * behind it); the ranges that say which characters are a mention follow every edit,
 * and what is sent and stored is the body with the tokens. Strings, announcements and the panel's status line arrive
 * as props: the panel owns the live region and the catalogue.
 */
import { format } from '@genoffice/i18n'
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useModalKeys } from '../modal-keys'
import { clearDraft, loadDraft, saveDraft, type CollabDraftKey } from './draft-store'
import { announcePolite } from './live-region'
import {
  MentionPicker,
  type CollabPickerStrings,
  type MentionRow,
  isSelectableRow,
  mentionOptionId,
  nextSelectableIndex,
  useMentionSearch,
} from './MentionPicker'
import { buildMentionToken } from './body'
import {
  type MentionDoc,
  applyMentionEdit,
  findMentionTrigger,
  mentionDocFromBody,
  mentionDocToBody,
  pickMention,
} from './mention-query'
import { toCollabError, type CollabHostState, type CollabSource } from './types'

export type CollabComposerMode = 'root' | 'reply' | 'edit' | 'discussion'

/** the catalogue keys the composer reads (Composer section of the spine) plus the picker's */
export interface CollabComposerStrings extends CollabPickerStrings {
  collabComposerComment: string
  collabComposerReply: string
  collabComposerDiscussion: string
  /** visually hidden label of the edit box */
  collabEdit: string
  collabSend: string
  /** the edit button */
  collabSave: string
  collabCancel: string
  /** `{shortcut}` */
  collabSendHint: string
  collabSending: string
  collabSendFailed: string
  collabDiscardTitle: string
  collabDiscardBody: string
  collabDiscard: string
  collabKeepWriting: string
  collabAiDraftLabel: string
}

export interface CollabComposerProps {
  host: CollabHostState
  mode: CollabComposerMode
  strings: CollabComposerStrings
  /** only `searchMentions` is used */
  source: Pick<CollabSource, 'searchMentions'>
  /** which composer this is in the document (`root:<anchor>`, `reply:<id>`, `discussion`, …); the document id comes from `host` */
  draftKey: string
  /** resolve = the server accepted; reject = keep the draft and show the failure */
  onSubmit(body: string): Promise<void>
  onCancel(): void
  /** edit: the current body; AI draft: the suggested text */
  initialBody?: string
  /** `sending`: a send is in flight; `status`: the panel status line says why Send is off */
  disabledReason?: 'sending' | 'status'
  /** id of the panel status line (`aria-describedby` of Send while `disabledReason` is `status`) */
  statusLineId?: string
  /** `initialBody` is a draft suggested by UniWork AI: label shown until edited or sent */
  aiDraft?: boolean
  /** polite live-region announcement; default: the window's collab live region */
  announce?: (text: string) => void
  /** focus the box on mount (when the user just opened this composer) */
  autoFocus?: boolean
  className?: string
}

export function CollabComposer(props: CollabComposerProps) {
  const {
    host,
    mode,
    strings,
    source,
    draftKey,
    onSubmit,
    onCancel,
    initialBody,
    disabledReason,
    statusLineId,
    aiDraft,
    announce = announcePolite,
    autoFocus,
    className,
  } = props
  const uid = useId()
  const hintId = `${uid}-hint`
  const errorId = `${uid}-error`
  const aiId = `${uid}-ai`
  const listboxId = `${uid}-mentions`
  const taRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const pendingCaret = useRef<number | null>(null)

  const storeKey = useMemo<CollabDraftKey>(
    () => ({ documentId: host.documentId, threadKey: draftKey }),
    [host.documentId, draftKey],
  )
  const keyId = `${storeKey.documentId}\u0000${storeKey.threadKey}`
  const startBody = () => loadDraft(storeKey) ?? initialBody ?? ''
  const [doc, setDoc] = useState<MentionDoc>(() => mentionDocFromBody(startBody()))
  const text = doc.text
  const [loadedKey, setLoadedKey] = useState(keyId)
  if (loadedKey !== keyId) {
    // another thread's composer reusing this instance: show that thread's draft
    setLoadedKey(keyId)
    setDoc(mentionDocFromBody(startBody()))
  }
  const [aiActive, setAiActive] = useState(() => !!aiDraft && startBody() === initialBody)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [pending, setPending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const found = findMentionTrigger(text, caret)
  // the `@` of a picked mention is a chip, not a search
  const trigger = found && !doc.ranges.some((r) => r.start === found.start) ? found : null
  const open = focused && !confirmOpen && trigger !== null && dismissedAt !== trigger.start
  const search = useMentionSearch({
    source,
    query: open ? trigger.query : null,
    strings,
    announce,
  })
  const rows = search.rows
  const effective = isSelectableRow(rows[activeIdx]) ? activeIdx : nextSelectableIndex(rows, -1, 1)

  const triggerQuery = trigger?.query
  useEffect(() => setActiveIdx(-1), [open, triggerQuery])
  useEffect(() => {
    if (trigger === null) setDismissedAt(null)
  }, [trigger])
  useEffect(() => {
    if (autoFocus) taRef.current?.focus()
  }, [autoFocus])
  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at !== null && taRef.current) {
      taRef.current.setSelectionRange(at, at)
      pendingCaret.current = null
    }
  })

  const base = initialBody ?? ''
  const body = mentionDocToBody(doc)
  const dirty = body.trim() !== '' && body !== base
  const isDiscussion = mode === 'discussion'

  function update(next: MentionDoc) {
    setDoc(next)
    const value = mentionDocToBody(next)
    if (value.trim() === '' || value === base) clearDraft(storeKey)
    else saveDraft(storeKey, value)
    setAiActive(false)
  }

  function pick(row: MentionRow) {
    if (row.kind === 'retry') {
      search.retry()
      return
    }
    if (row.kind !== 'candidate') return
    const at = taRef.current?.selectionStart ?? caret
    const t = findMentionTrigger(text, at)
    if (!t) return
    const { user_id: id, display_name: label } = row.candidate
    const out = pickMention(doc, t, at, { id, label, raw: buildMentionToken(id, label) })
    pendingCaret.current = out.caret
    setCaret(out.caret)
    update(out.doc)
    taRef.current?.focus()
  }

  const sendBlocked = pending || disabledReason !== undefined || body.trim() === ''

  async function send() {
    if (sendBlocked || sendingRef.current) return
    sendingRef.current = true
    setPending(true)
    setSendError(false)
    const sent = body.trim()
    try {
      await onSubmit(sent)
      clearDraft(storeKey)
      setAiActive(false)
      if (mode !== 'edit') setDoc({ text: '', ranges: [] })
    } catch (e) {
      const err = toCollabError(e)
      // a deleted target is reported by the host next to the thread, not as a send failure
      if (!(err.code === 'conflict' && err.detailsCode === 'comment_deleted')) {
        setSendError(true)
        announce(strings.collabSendFailed)
      }
    } finally {
      sendingRef.current = false
      setPending(false)
    }
  }

  function requestCancel() {
    if (dirty) setConfirmOpen(true)
    else discard()
  }

  function discard() {
    clearDraft(storeKey)
    setConfirmOpen(false)
    onCancel()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void send()
      return
    }
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(nextSelectableIndex(rows, effective, e.key === 'ArrowDown' ? 1 : -1))
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && effective >= 0) {
        e.preventDefault()
        pick(rows[effective]!)
        return
      }
      if (e.key === 'Escape') {
        // closes the picker only; the typed text stays plain text
        e.preventDefault()
        e.stopPropagation()
        setDismissedAt(trigger.start)
        return
      }
    } else if (e.key === 'Escape') {
      // an empty persistent discussion composer has nothing to cancel: Esc falls through so the host closes its panel
      if (isDiscussion && !dirty) return
      e.preventDefault()
      e.stopPropagation()
      requestCancel()
    }
  }

  const label =
    mode === 'edit'
      ? strings.collabEdit
      : mode === 'reply'
        ? strings.collabComposerReply
        : mode === 'discussion'
          ? strings.collabComposerDiscussion
          : strings.collabComposerComment
  const shortcut = host.platform === 'mac' ? '⌘Enter' : 'Ctrl+Enter'
  const sendLabel =
    pending || disabledReason === 'sending'
      ? strings.collabSending
      : mode === 'edit'
        ? strings.collabSave
        : strings.collabSend
  const describedBy = [sendError ? errorId : null, aiActive ? aiId : null, hintId].filter(Boolean)
  const candidateCount = rows.filter((r) => r.kind === 'candidate').length

  return (
    <div className={className ? `collab-composer ${className}` : 'collab-composer'}>
      {aiActive ? (
        <p className="collab-composer-ai" id={aiId}>
          {strings.collabAiDraftLabel}
        </p>
      ) : null}
      <div className="collab-composer-field">
        <div className="collab-composer-mirror" ref={mirrorRef} aria-hidden="true">
          {mirrorParts(doc)}
        </div>
        <textarea
          ref={taRef}
          className="collab-composer-input"
          rows={2}
          value={text}
          readOnly={pending}
          aria-label={label}
          placeholder={mode === 'edit' ? undefined : label}
          aria-describedby={describedBy.join(' ')}
          {...(open
            ? {
                role: 'combobox',
                'aria-expanded': true,
                'aria-controls': listboxId,
                'aria-autocomplete': 'list' as const,
                'aria-activedescendant':
                  effective >= 0 ? mentionOptionId(listboxId, effective) : undefined,
              }
            : {})}
          onChange={(e) => {
            setFocused(true)
            const edit = applyMentionEdit(
              doc,
              e.currentTarget.value,
              e.currentTarget.selectionStart,
            )
            const at = edit.mapCaret(e.currentTarget.selectionStart)
            if (edit.doc.text !== e.currentTarget.value) pendingCaret.current = at
            setCaret(at)
            update(edit.doc)
          }}
          onScroll={(e) => {
            if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            // coming back to the box must not reopen a picker the user left
            if (trigger) setDismissedAt(trigger.start)
          }}
        />
      </div>
      {sendError ? (
        <p className="collab-composer-error" id={errorId}>
          {strings.collabSendFailed}
        </p>
      ) : null}
      <div className="collab-composer-actions">
        <span className="collab-composer-hint" id={hintId}>
          {format(strings.collabSendHint, { shortcut })}
        </span>
        {isDiscussion && body.trim() === '' ? null : (
          <button type="button" className="collab-composer-btn" onClick={requestCancel}>
            {strings.collabCancel}
          </button>
        )}
        <button
          type="button"
          className="collab-composer-btn collab-composer-send"
          aria-disabled={sendBlocked || undefined}
          aria-describedby={disabledReason === 'status' ? statusLineId : undefined}
          onClick={() => void send()}
        >
          {sendLabel}
        </button>
      </div>
      {open ? (
        <MentionPicker
          listboxId={listboxId}
          label={strings.collabMentionLabel}
          rows={rows}
          activeIndex={effective}
          onPick={pick}
          footer={
            search.status === 'ready' && candidateCount > 0
              ? format(strings.collabMentionCount, { count: candidateCount })
              : undefined
          }
        />
      ) : null}
      {confirmOpen
        ? createPortal(
            <DiscardDialog
              strings={strings}
              onKeep={() => setConfirmOpen(false)}
              onDiscard={discard}
            />,
            document.body,
          )
        : null}
    </div>
  )
}

/** the text with each mention range in a `<mark>`; the trailing newline keeps the last line's height */
function mirrorParts(doc: MentionDoc): ReactNode[] {
  const parts: ReactNode[] = []
  let at = 0
  for (const r of doc.ranges) {
    if (r.start > at) parts.push(doc.text.slice(at, r.start))
    parts.push(<mark key={r.start}>{doc.text.slice(r.start, r.end)}</mark>)
    at = r.end
  }
  parts.push(doc.text.slice(at) + '\n')
  return parts
}

/** "Discard the draft?" — a modal question; "Keep writing" has the focus */
function DiscardDialog({
  strings,
  onKeep,
  onDiscard,
}: {
  strings: CollabComposerStrings
  onKeep(): void
  onDiscard(): void
}): ReactNode {
  const id = useId()
  const keepRef = useRef<HTMLButtonElement>(null)
  // declared before the focus effect: it must remember the control that had focus
  const modal = useModalKeys(onKeep, { restoreFocus: true })
  useEffect(() => keepRef.current?.focus(), [])
  return (
    <div
      className="collab-discard-backdrop"
      ref={modal.ref}
      onKeyDown={modal.onKeyDown}
      tabIndex={-1}
    >
      <div
        className="collab-discard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
      >
        <h3 className="collab-discard-title" id={`${id}-title`}>
          {strings.collabDiscardTitle}
        </h3>
        <p className="collab-discard-body" id={`${id}-body`}>
          {strings.collabDiscardBody}
        </p>
        <div className="collab-discard-actions">
          <button
            type="button"
            className="collab-composer-btn collab-composer-danger"
            data-danger="true"
            onClick={onDiscard}
          >
            {strings.collabDiscard}
          </button>
          <button type="button" className="collab-composer-btn" ref={keepRef} onClick={onKeep}>
            {strings.collabKeepWriting}
          </button>
        </div>
      </div>
    </div>
  )
}
