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
  MentionAccessDialog,
  type MentionAccessPerson,
  type MentionAccessState,
  type MentionAccessStrings,
} from './MentionAccessDialog'
import { NoAccessBadge } from './NoAccessBadge'
import {
  type MentionDoc,
  applyMentionEdit,
  canShareView,
  findMentionTrigger,
  formatMentionNames,
  mentionDocFromBody,
  mentionDocToBody,
  pickMention,
  uniqueMentionLabel,
} from './mention-query'
import { toCollabError, type CollabHostState, type CollabSource } from './types'

export type CollabComposerMode = 'root' | 'reply' | 'edit' | 'discussion'

/** the catalogue keys the composer reads (Composer section of the spine) plus the picker's */
export interface CollabComposerStrings extends CollabPickerStrings, MentionAccessStrings {
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
  /** `{sharedNames}` */
  collabSendFailedAfterShare: string
}

export interface CollabComposerProps {
  host: CollabHostState
  mode: CollabComposerMode
  strings: CollabComposerStrings
  /** `searchMentions` (+ optional `canListMembers` and `shareView` for G8-18) */
  source: Pick<CollabSource, 'searchMentions' | 'canListMembers' | 'shareView'>
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
  const sharedUserIdsRef = useRef<Set<string>>(new Set())
  const skippedUserIdsRef = useRef<Set<string>>(new Set())
  const sharedNamesRef = useRef<string[]>([])

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
    sharedUserIdsRef.current.clear()
    skippedUserIdsRef.current.clear()
    sharedNamesRef.current = []
  }
  const [aiActive, setAiActive] = useState(() => !!aiDraft && startBody() === initialBody)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [pending, setPending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [sendErrorText, setSendErrorText] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [warnState, setWarnState] = useState<MentionAccessState | null>(null)

  const warnOpen = warnState !== null
  const found = findMentionTrigger(text, caret)
  // the `@` of a picked mention is a chip, not a search
  const trigger = found && !doc.ranges.some((r) => r.start === found.start) ? found : null
  const open =
    focused && !confirmOpen && !warnOpen && trigger !== null && dismissedAt !== trigger.start
  const search = useMentionSearch({
    source,
    query: open ? trigger.query : null,
    strings,
    announce,
    canListMembers: host.canListMembers ?? source.canListMembers,
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
  // after a failed send the warn dialog is gone and the focused button with it: put focus back on the
  // composer (the error line sits right under it) instead of letting it drop to BODY
  const refocusAfterFailRef = useRef(false)
  useEffect(() => {
    if (!refocusAfterFailRef.current || warnState !== null || pending) return
    refocusAfterFailRef.current = false
    const active = document.activeElement
    if (
      (!active || active === document.body || !active.isConnected) &&
      taRef.current?.isConnected
    ) {
      taRef.current.focus()
    }
  }, [warnState, pending, sendError])
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
    const { user_id: id, can_view: canView } = row.candidate
    // another person in the draft may share this name: the label takes the web's suffix
    const label = uniqueMentionLabel(row.candidate, doc)
    const out = pickMention(doc, t, at, {
      id,
      label,
      raw: buildMentionToken(id, label),
      ...(canView !== undefined ? { canView } : {}),
    })
    pendingCaret.current = out.caret
    setCaret(out.caret)
    update(out.doc)
    taRef.current?.focus()
  }

  const sendBlocked = pending || disabledReason !== undefined || body.trim() === ''
  const hasShareCap = canShareView(host, source)

  function collectUnsharedNoAccess(): MentionAccessPerson[] {
    const seen = new Set<string>()
    const out: MentionAccessPerson[] = []
    for (const r of doc.ranges) {
      if (r.canView !== false) continue
      if (sharedUserIdsRef.current.has(r.id) || skippedUserIdsRef.current.has(r.id)) continue
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push({ id: r.id, label: r.label })
    }
    return out
  }

  async function performSubmit(sharedNames: readonly string[] = sharedNamesRef.current) {
    if (sendBlocked || sendingRef.current) return
    sendingRef.current = true
    setPending(true)
    setSendError(false)
    setSendErrorText(null)
    const sent = body.trim()
    try {
      await onSubmit(sent)
      clearDraft(storeKey)
      setAiActive(false)
      sharedUserIdsRef.current.clear()
      skippedUserIdsRef.current.clear()
      sharedNamesRef.current = []
      if (mode !== 'edit') {
        setDoc({ text: '', ranges: [] })
        if (taRef.current?.isConnected) taRef.current.focus()
      }
    } catch (e) {
      const err = toCollabError(e)
      // a deleted target is reported by the host next to the thread, not as a send failure
      if (!(err.code === 'conflict' && err.detailsCode === 'comment_deleted')) {
        const msg =
          sharedNames.length > 0
            ? format(strings.collabSendFailedAfterShare, {
                sharedNames: formatMentionNames(sharedNames, host.lang),
              })
            : strings.collabSendFailed
        setSendErrorText(sharedNames.length > 0 ? msg : null)
        setSendError(true)
        announce(msg)
        // the warn dialog is unmounted by now; the effect below restores focus once that commit is in
        refocusAfterFailRef.current = true
      }
    } finally {
      sendingRef.current = false
      setPending(false)
    }
  }

  async function send() {
    if (sendBlocked || sendingRef.current) return
    const unshared = collectUnsharedNoAccess()
    if (unshared.length > 0) {
      setWarnState({
        people: unshared,
        sharing: false,
        sharedIds: [],
        failedIds: [],
      })
      return
    }
    await performSubmit()
  }

  async function runShare(targetIds: string[]) {
    if (!warnState || warnState.sharing || !source.shareView) return
    setWarnState((s) => (s ? { ...s, sharing: true } : s))
    const newlyShared: string[] = []
    const failed: string[] = []
    for (const uid of targetIds) {
      try {
        await source.shareView({ user_id: uid })
        newlyShared.push(uid)
      } catch {
        failed.push(uid)
      }
    }
    const allSharedIds = [...new Set([...warnState.sharedIds, ...newlyShared])]
    if (newlyShared.length > 0) {
      for (const uid of newlyShared) sharedUserIdsRef.current.add(uid)
      setDoc((prev) => ({
        ...prev,
        ranges: prev.ranges.map((r) => (newlyShared.includes(r.id) ? { ...r, canView: true } : r)),
      }))
    }
    const allSharedNames = warnState.people
      .filter((p) => allSharedIds.includes(p.id))
      .map((p) => p.label)
    if (allSharedNames.length > 0) {
      sharedNamesRef.current = allSharedNames
    }
    if (failed.length === 0) {
      for (const p of warnState.people) {
        if (!allSharedIds.includes(p.id)) skippedUserIdsRef.current.add(p.id)
      }
      setWarnState(null)
      await performSubmit(allSharedNames)
    } else {
      setWarnState((s) =>
        s
          ? {
              ...s,
              sharing: false,
              sharedIds: allSharedIds,
              failedIds: failed,
            }
          : null,
      )
    }
  }

  function sendNowFromWarn() {
    if (!warnState || warnState.sharing) return
    const sharedNames = warnState.people
      .filter((p) => warnState.sharedIds.includes(p.id))
      .map((p) => p.label)
    for (const p of warnState.people) {
      if (!warnState.sharedIds.includes(p.id)) skippedUserIdsRef.current.add(p.id)
    }
    setWarnState(null)
    void performSubmit(sharedNames)
  }

  function cancelWarn() {
    if (warnState?.sharing) return
    setWarnState(null)
    taRef.current?.focus()
  }

  function requestCancel() {
    if (dirty) setConfirmOpen(true)
    else discard()
  }

  function discard() {
    clearDraft(storeKey)
    setDoc(mentionDocFromBody(base))
    setAiActive(false)
    setSendError(false)
    setSendErrorText(null)
    setConfirmOpen(false)
    setWarnState(null)
    sharedUserIdsRef.current.clear()
    skippedUserIdsRef.current.clear()
    sharedNamesRef.current = []
    onCancel()
    if (isDiscussion && taRef.current?.isConnected) taRef.current.focus()
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
      // an empty new-thread composer cancels itself but leaves the Esc unconsumed, so a host that closes
      // its pane on a non-prevented Esc (Slides) still sees it; a dirty one keeps the Discard dialog
      if (mode === 'root' && !dirty) {
        // an unedited non-empty draft (AI initialBody) is not dirty but must stay untouched: fall through
        if (body.trim() === '') requestCancel()
        return
      }
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
  const noAccessRanges = doc.ranges.filter((r) => r.canView === false)

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
      {noAccessRanges.length > 0 ? (
        <div className="collab-composer-chips">
          {noAccessRanges.map((r) => (
            <span
              key={r.start}
              className="collab-mention-chip collab-mention-chip--no-access"
              data-no-access="true"
            >
              <span className="collab-mention-chip-name">@{r.label}</span>
              <NoAccessBadge label={strings.collabMentionNoAccessBadge} />
            </span>
          ))}
        </div>
      ) : null}
      {sendError ? (
        <p className="collab-composer-error" id={errorId}>
          {sendErrorText ?? strings.collabSendFailed}
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
          noAccessBadge={strings.collabMentionNoAccessBadge}
          footer={
            search.status === 'ready' && candidateCount > 0
              ? format(strings.collabMentionCount, { count: candidateCount })
              : undefined
          }
        />
      ) : null}
      {warnState
        ? createPortal(
            <MentionAccessDialog
              state={warnState}
              canShare={hasShareCap}
              lang={host.lang}
              strings={strings}
              announce={announce}
              onShare={(ids) => void runShare(ids)}
              onSendNow={sendNowFromWarn}
              onCancel={cancelWarn}
            />,
            document.body,
          )
        : null}
      {confirmOpen
        ? createPortal(
            <DiscardDialog
              strings={strings}
              onKeep={() => {
                setConfirmOpen(false)
                taRef.current?.focus()
              }}
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
    parts.push(
      <mark
        key={r.start}
        data-no-access={r.canView === false ? 'true' : undefined}
        className={r.canView === false ? 'collab-composer-mark--no-access' : undefined}
      >
        {doc.text.slice(r.start, r.end)}
      </mark>,
    )
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
  const modal = useModalKeys(onKeep)
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
