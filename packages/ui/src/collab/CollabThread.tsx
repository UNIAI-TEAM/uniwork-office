/**
 * One collab thread (spine S12/S13 "Một thread"): root + replies (oldest first), tombstone frame, the action
 * row (Reply, Go to location, More actions menu, Resolve/Reopen), inline edit with Esc + discard ask, the
 * edit history, and the one-step delete dialog. Actions a level does not allow are hidden, never
 * `aria-disabled` (S12 "Chỉ xem"). The body, the anchor label and the composer are host-supplied slots.
 */
import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { format } from '@genoffice/i18n'
import { useModalKeys } from '../modal-keys'
import { AnchorLabel, type AnchorLabelStrings } from './AnchorLabel'
import { CollabBody } from './CollabBody'
import type {
  CollabActions,
  CollabConflict,
  CollabNetStatus,
  CollabPermissions,
  CollabStrings,
  CollabThreadView,
} from './use-collab-threads'
import type {
  CollabAnchor,
  CollabAnchorAdapter,
  CollabAnchorState,
  CollabComment,
  CollabError,
  CollabHostState,
  CollabMention,
  CollabRevision,
  CollabSource,
} from './types'

/** what the anchor slot gets; the renderer puts `labelId` on the label and `stateId` on the state text */
export interface CollabAnchorSlot {
  anchor: CollabAnchor
  /** undefined: a new thread that is not sent yet (no state text) */
  anchorState?: CollabAnchorState
  labelId: string
  stateId: string
  host: CollabHostState
  adapter?: CollabAnchorAdapter
}

/** the props a composer slot gets (worker C's `CollabComposer` takes the same shape) */
export interface CollabComposerSlot {
  host: CollabHostState
  source: CollabSource
  mode: 'root' | 'reply' | 'discussion'
  /** draft key inside the document: 'root:<anchor>', 'reply:<threadId>', 'discussion' */
  draftKey: string
  /** 'status': the panel status line explains why Send does not run */
  disabledReason?: 'status'
  statusLineId?: string
  onSubmit(body: string): Promise<void>
  onCancel(): void
  autoFocus?: boolean
}

export type CollabRenderBody = (
  comment: CollabComment,
  mentions: readonly CollabMention[],
) => ReactNode
export type CollabRenderAnchor = (slot: CollabAnchorSlot) => ReactNode
export type CollabRenderComposer = (slot: CollabComposerSlot) => ReactNode

export const defaultRenderBody: CollabRenderBody = (c, mentions) => (
  <CollabBody body={c.body} mentions={mentions} />
)

/** default anchor slot: the format label + the stale / lost state as words; sheet names come from the adapter */
export function defaultRenderAnchor(slot: CollabAnchorSlot, strings: CollabStrings): ReactNode {
  const adapter = slot.adapter
  return (
    <AnchorLabel
      anchor={slot.anchor}
      state={slot.anchorState}
      lang={slot.host.lang}
      strings={strings as unknown as AnchorLabelStrings}
      activeSheet={adapter?.activeSheet?.()}
      resolveSheetName={adapter?.sheetName ? (id) => adapter.sheetName?.(id) : undefined}
      labelId={slot.labelId}
      stateId={slot.stateId}
    />
  )
}

/** spine `{time}`: local time, no seconds; same day -> time, same year -> day + month + time, else + year */
export function formatCollabTime(iso: string | undefined, lang: string, now = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
  const opts: Intl.DateTimeFormatOptions =
    d.toDateString() === now.toDateString()
      ? time
      : d.getFullYear() === now.getFullYear()
        ? { ...time, day: 'numeric', month: 'short' }
        : { ...time, day: 'numeric', month: 'short', year: 'numeric' }
  try {
    return new Intl.DateTimeFormat(lang, opts).format(d)
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(d)
  }
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = [...words[0]!][0] ?? ''
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : ''
  return (first + last).toUpperCase()
}

function copyText(text: string): void {
  try {
    void navigator.clipboard?.writeText(text)?.catch(() => {})
  } catch {
    // clipboard blocked: nothing to show, the text is still on screen
  }
}

/* ---------- dialog ---------- */

interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  defaultFocus: 'confirm' | 'cancel'
  onConfirm(): void
  onCancel(): void
}

/** one-step confirm (delete, discard): Esc / Cancel close, Tab stays inside, the caller restores focus */
export function CollabConfirmDialog(p: ConfirmDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  const { ref, onKeyDown } = useModalKeys(p.onCancel)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const defaultFocus = p.defaultFocus
  useEffect(() => {
    ;(defaultFocus === 'confirm' ? confirmRef : cancelRef).current?.focus()
  }, [defaultFocus])
  return (
    <div className="collab-scrim" ref={ref} onKeyDown={onKeyDown}>
      <div
        className="collab-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <h2 id={titleId} className="collab-dialog-title">
          {p.title}
        </h2>
        <p id={bodyId} className="collab-dialog-body">
          {p.body}
        </p>
        <div className="collab-dialog-acts">
          <button ref={cancelRef} type="button" className="collab-btn" onClick={p.onCancel}>
            {p.cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="collab-btn collab-btn--danger"
            onClick={p.onConfirm}
          >
            {p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- actions menu ---------- */

interface MenuItem {
  key: string
  label: string
  onSelect(): void
}

function ActionsMenu({
  label,
  items,
  buttonRef,
}: {
  label: string
  items: MenuItem[]
  buttonRef: RefObject<HTMLButtonElement | null>
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const onMenuKey = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    const all = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = all.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      all[(at + step + all.length) % all.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      ;(e.key === 'Home' ? all[0] : all[all.length - 1])?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'Tab') close(false)
  }

  if (items.length === 0) return null
  return (
    <span
      className="collab-menu-wrap"
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="collab-ico"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="collab-menu"
          onKeyDown={onMenuKey}
        >
          {items.map((it) => (
            <li key={it.key} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="collab-menu-item"
                data-action={it.key}
                onClick={() => {
                  close(true)
                  it.onSelect()
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}

/* ---------- edit box ---------- */

function EditBox({
  initial,
  strings,
  onSave,
  onClose,
}: {
  initial: string
  strings: CollabStrings
  onSave(body: string): Promise<void>
  onClose(): void
}) {
  const [text, setText] = useState(initial)
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const labelId = useId()

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const cancel = () => {
    if (text !== initial) setAsking(true)
    else onClose()
  }
  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(text)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="collab-edit">
      <label id={labelId} className="collab-sr">
        {strings.collabEdit}
      </label>
      <textarea
        ref={areaRef}
        className="collab-textarea"
        aria-labelledby={labelId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            cancel()
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void save()
          }
        }}
      />
      <div className="collab-edit-acts">
        <button type="button" className="collab-btn" onClick={cancel}>
          {strings.collabCancel}
        </button>
        <button
          type="button"
          className="collab-btn collab-btn--primary"
          aria-disabled={saving || undefined}
          onClick={() => void save()}
        >
          {strings.collabSave}
        </button>
      </div>
      {asking && (
        <CollabConfirmDialog
          title={strings.collabDiscardTitle ?? ''}
          body={strings.collabDiscardBody ?? ''}
          confirmLabel={strings.collabDiscard ?? ''}
          cancelLabel={strings.collabKeepWriting ?? ''}
          defaultFocus="cancel"
          onConfirm={() => {
            setAsking(false)
            onClose()
          }}
          onCancel={() => {
            setAsking(false)
            areaRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

/* ---------- history ---------- */

type HistoryState =
  { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; revisions: CollabRevision[] }

function History({
  comment,
  strings,
  lang,
  load,
  nameOf,
  renderBody,
  mentions,
  formatTime,
  onClose,
  onDeleted,
}: {
  comment: CollabComment
  strings: CollabStrings
  lang: string
  load(): Promise<CollabRevision[]>
  nameOf(id: string | null): string
  renderBody: CollabRenderBody
  mentions: readonly CollabMention[]
  formatTime(iso: string | undefined): string
  onClose(): void
  onDeleted(): void
}) {
  const [st, setSt] = useState<HistoryState>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const titleId = useId()
  const loadRef = useRef(load)
  loadRef.current = load
  const onDeletedRef = useRef(onDeleted)
  onDeletedRef.current = onDeleted

  useEffect(() => {
    let live = true
    setSt({ phase: 'loading' })
    loadRef.current().then(
      (revisions) => {
        if (live) setSt({ phase: 'ready', revisions })
      },
      (e: CollabError) => {
        if (!live) return
        if (e?.code === 'conflict' && e.detailsCode === 'comment_deleted') onDeletedRef.current()
        else setSt({ phase: 'error' })
      },
    )
    return () => {
      live = false
    }
  }, [attempt])

  const current = comment.revision ?? 1
  const older =
    st.phase === 'ready'
      ? st.revisions.filter((r) => r.revision !== current).sort((a, b) => b.revision - a.revision)
      : []
  return (
    <section className="collab-hist" aria-labelledby={titleId} lang={lang}>
      <div className="collab-hist-head">
        <h4 id={titleId}>{strings.collabHistoryTitle}</h4>
        <button
          type="button"
          className="collab-ico"
          aria-label={format(strings.collabClosePanel ?? '', {
            panel: strings.collabHistoryTitle ?? '',
          })}
          onClick={onClose}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </div>
      {st.phase === 'loading' && <p className="collab-cap">{strings.collabLoading}</p>}
      {st.phase === 'error' && (
        <p className="collab-cap collab-cap--err">
          {strings.collabHistoryError}{' '}
          <button type="button" className="collab-link" onClick={() => setAttempt((n) => n + 1)}>
            {strings.collabRetry}
          </button>
        </p>
      )}
      {st.phase === 'ready' && older.length === 0 && (
        <p className="collab-cap">{strings.collabHistoryEmpty}</p>
      )}
      {st.phase === 'ready' && older.length > 0 && (
        <ul className="collab-hist-list">
          <li>
            <div className="collab-cap">{strings.collabHistoryCurrent}</div>
            <div className="collab-bd">{renderBody(comment, mentions)}</div>
          </li>
          {older.map((r) => (
            <li key={r.id}>
              <div className="collab-cap">
                {format(strings.collabHistoryEntry ?? '', {
                  name: nameOf(r.created_by_id),
                  time: formatTime(r.created_at),
                })}
              </div>
              <div className="collab-bd">
                {renderBody({ ...comment, body: r.body, revision: r.revision }, mentions)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ---------- thread ---------- */

export interface CollabThreadProps {
  thread: CollabThreadView
  host: CollabHostState
  source: CollabSource
  strings: CollabStrings
  can: CollabPermissions
  actions: CollabActions
  mentions: readonly CollabMention[]
  expanded: boolean
  onToggleExpanded(threadId: string): void
  status: CollabNetStatus | null
  statusLineId?: string
  conflict: CollabConflict | null
  adapter?: CollabAnchorAdapter
  renderBody?: CollabRenderBody
  renderAnchor?: CollabRenderAnchor
  renderComposer?: CollabRenderComposer
  formatTime?(iso: string | undefined): string
  /** called before a resolve / reopen so the panel puts focus back on that button after the move */
  onKeepFocus?(threadId: string): void
}

function CollabThreadImpl(p: CollabThreadProps) {
  const { thread, host, strings, can, actions, mentions } = p
  const base = useId()
  const ids = {
    heading: `${base}h`,
    label: `${base}l`,
    state: `${base}s`,
    resolved: `${base}r`,
    replies: `${base}rl`,
  }
  const renderBody = p.renderBody ?? defaultRenderBody
  const fmt = p.formatTime ?? ((iso: string | undefined) => formatCollabTime(iso, host.lang))
  const [replyOpen, setReplyOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const replyBtnRef = useRef<HTMLButtonElement>(null)
  const itemRef = useRef<HTMLLIElement>(null)
  /** the control that opened history / edit / delete, for focus return */
  const openerRef = useRef<HTMLElement | null>(null)
  const restoreCommentRef = useRef<string | null>(null)
  const restoreReplyRef = useRef(false)

  const comment = host.kind === 'comment'
  const { root } = thread
  const rootAuthorId = `${base}a-${root.id}`
  const nameOf = (c: CollabComment) => c.display_name || strings.collabFormerMember || ''
  const revisionName = (c: CollabComment) => (id: string | null) => {
    if (id && id === c.author_id) return nameOf(c)
    const m = id ? mentions.find((x) => x.user_id === id && x.state === 'ok') : undefined
    return m?.display_name || (id === null ? nameOf(c) : strings.collabFormerMember || '')
  }

  const restore = (commentId?: string) => {
    const el = openerRef.current
    openerRef.current = null
    if (el && el.isConnected) {
      el.focus()
      return
    }
    if (commentId) restoreCommentRef.current = commentId
  }

  useLayoutEffect(() => {
    const commentId = restoreCommentRef.current
    if (!commentId || editing === commentId) return
    restoreCommentRef.current = null
    const scope = [
      ...(itemRef.current?.querySelectorAll<HTMLElement>('[data-comment-id]') ?? []),
    ].find((n) => n.dataset.commentId === commentId)
    const target =
      scope?.querySelector<HTMLElement>('button[aria-haspopup="menu"]') ??
      scope?.querySelector<HTMLElement>('button') ??
      itemRef.current?.querySelector<HTMLElement>('[data-thread-heading]')
    target?.focus()
  }, [editing, historyFor, deleting])

  useLayoutEffect(() => {
    if (replyOpen || !restoreReplyRef.current) return
    restoreReplyRef.current = false
    const target =
      (replyBtnRef.current?.isConnected ? replyBtnRef.current : null) ??
      itemRef.current?.querySelector<HTMLElement>('[data-thread-heading]')
    target?.focus()
  }, [replyOpen])

  const run = async (fn: () => Promise<unknown>) => {
    setFailed(false)
    try {
      await fn()
    } catch {
      setFailed(true)
    }
  }

  const anchorSlot =
    comment && root.anchor
      ? (p.renderAnchor
          ? p.renderAnchor
          : (s: CollabAnchorSlot) => defaultRenderAnchor(s, strings))({
          anchor: root.anchor,
          anchorState: thread.anchorState,
          labelId: ids.label,
          stateId: ids.state,
          host,
          adapter: p.adapter,
        })
      : null

  const labelledBy = [
    thread.deleted ? `${base}d-${root.id}` : rootAuthorId,
    comment && root.anchor ? ids.label : null,
    comment && (thread.anchorState === 'stale' || thread.anchorState === 'lost') ? ids.state : null,
    thread.resolved ? ids.resolved : null,
  ]
    .filter(Boolean)
    .join(' ')

  const resolvedBadge = thread.resolved ? (
    <span id={ids.resolved} className="collab-badge collab-badge--ok">
      {strings.collabResolved}
    </span>
  ) : null

  const renderItem = (c: CollabComment, isRoot: boolean) => {
    const deleted = !!c.deleted_at
    const authorId = isRoot ? rootAuthorId : `${base}a-${c.id}`
    const headRow = deleted ? null : (
      <>
        <span className="collab-av" aria-hidden="true">
          {initials(nameOf(c))}
        </span>
        <span className="collab-au" id={authorId}>
          {nameOf(c)}
        </span>
        {(c.revision ?? 1) > 1 && (
          <button
            type="button"
            className="collab-link"
            aria-expanded={historyFor === c.id}
            onClick={(e) => {
              if (historyFor === c.id) {
                setHistoryFor(null)
                return
              }
              openerRef.current = e.currentTarget
              setHistoryFor(c.id)
            }}
          >
            {format(strings.collabEdited ?? '', { time: fmt(c.updated_at) })}
          </button>
        )}
        <span className="collab-dt">{fmt(c.created_at)}</span>
      </>
    )
    const asHeading = isRoot && !comment
    const menuRef = { current: null as HTMLButtonElement | null }
    const menuItems: MenuItem[] = deleted
      ? []
      : [
          ...(can.canEdit(c)
            ? [
                {
                  key: 'edit',
                  label: strings.collabEdit ?? '',
                  onSelect: () => {
                    openerRef.current = menuRef.current
                    setEditing(c.id)
                  },
                },
              ]
            : []),
          ...(can.canRemove(c)
            ? [
                {
                  key: 'delete',
                  label: strings.collabDelete ?? '',
                  onSelect: () => {
                    openerRef.current = menuRef.current
                    setDeleting(c.id)
                  },
                },
              ]
            : []),
          { key: 'copy', label: strings.collabCopyText ?? '', onSelect: () => copyText(c.body) },
          {
            key: 'history',
            label: strings.collabHistory ?? '',
            onSelect: () => {
              openerRef.current = menuRef.current
              setHistoryFor(c.id)
            },
          },
        ]
    return (
      <div className={isRoot ? 'collab-cm' : 'collab-cm collab-cm--reply'} data-comment-id={c.id}>
        {deleted ? (
          <div
            className="collab-tomb"
            id={`${base}d-${c.id}`}
            tabIndex={-1}
            data-deleted-for={c.id}
            {...(asHeading ? { 'data-thread-heading': '' } : {})}
          >
            {strings.collabDeleted}
          </div>
        ) : asHeading ? (
          <h3
            className="collab-cmh collab-th"
            id={ids.heading}
            tabIndex={-1}
            data-thread-heading=""
          >
            {headRow}
            {resolvedBadge}
          </h3>
        ) : (
          <div className="collab-cmh">{headRow}</div>
        )}
        {!deleted &&
          (editing === c.id ? (
            <EditBox
              initial={c.body}
              strings={strings}
              onSave={async (body) => {
                setFailed(false)
                try {
                  await actions.edit(c.id, body)
                  setEditing(null)
                  restore(c.id)
                } catch {
                  setFailed(true)
                }
              }}
              onClose={() => {
                setEditing(null)
                restore(c.id)
              }}
            />
          ) : (
            <div className="collab-bd">{renderBody(c, mentions)}</div>
          ))}
        {!deleted && editing !== c.id && (
          <div className="collab-acts">
            {can.canWrite && !thread.deleted && p.renderComposer && (
              <button
                ref={isRoot ? replyBtnRef : undefined}
                type="button"
                className="collab-link"
                onClick={() => setReplyOpen(true)}
              >
                {strings.collabReply}
              </button>
            )}
            {isRoot && comment && root.anchor && p.adapter && thread.anchorState !== 'lost' && (
              <button
                type="button"
                className="collab-link"
                onClick={() => p.adapter?.goTo(root.anchor!)}
              >
                {strings.collabGoToAnchor}
              </button>
            )}
            <ActionsMenu
              label={strings.collabActions ?? ''}
              items={menuItems}
              buttonRef={menuRef}
            />
            {isRoot && can.canResolve(root) && (
              <button
                type="button"
                className="collab-link collab-resolve"
                data-resolve-for={root.id}
                onClick={() => {
                  p.onKeepFocus?.(root.id)
                  void run(() =>
                    thread.resolved ? actions.reopen(root.id) : actions.resolve(root.id),
                  )
                }}
              >
                {thread.resolved ? strings.collabReopen : strings.collabResolve}
              </button>
            )}
          </div>
        )}
        {historyFor === c.id && (
          <History
            comment={c}
            strings={strings}
            lang={host.lang}
            load={() => actions.history(c.id)}
            nameOf={revisionName(c)}
            renderBody={renderBody}
            mentions={mentions}
            formatTime={fmt}
            onClose={() => {
              setHistoryFor(null)
              restore(c.id)
            }}
            onDeleted={() => setHistoryFor(null)}
          />
        )}
        {deleting === c.id && (
          <CollabConfirmDialog
            title={strings.collabDeleteTitle ?? ''}
            body={strings.collabDeleteBody ?? ''}
            confirmLabel={strings.collabDeleteConfirm ?? ''}
            cancelLabel={strings.collabCancel ?? ''}
            defaultFocus="cancel"
            onConfirm={() => {
              setDeleting(null)
              restore(c.id)
              void run(() => actions.remove(c.id))
            }}
            onCancel={() => {
              setDeleting(null)
              restore(c.id)
            }}
          />
        )}
      </div>
    )
  }

  const conflict = p.conflict && p.conflict.threadId === thread.id ? p.conflict : null
  // the deleted frame appears where the thread was, possibly scrolled out of view: bring it in without taking
  // focus from the composer that holds the draft
  useEffect(() => {
    if (!conflict) return
    itemRef.current
      ?.querySelector<HTMLElement>('[data-deleted-for]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [conflict])
  // a reply that hit comment_deleted keeps its composer (and draft) under the deleted thread
  const showComposer =
    replyOpen && can.canWrite && (!thread.deleted || conflict !== null) && p.renderComposer

  return (
    <li
      ref={itemRef}
      className={[
        'collab-thread',
        thread.resolved ? 'collab-thread--resolved' : '',
        thread.deleted ? 'collab-thread--deleted' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="listitem"
      aria-labelledby={labelledBy}
      data-thread-id={thread.id}
    >
      {comment && (
        <h3
          className={`collab-th collab-th--${thread.anchorState ?? 'plain'}`}
          id={ids.heading}
          tabIndex={-1}
          data-thread-heading=""
        >
          <span className="collab-al">{anchorSlot}</span>
          {resolvedBadge}
        </h3>
      )}
      {!comment && thread.deleted && resolvedBadge}
      {renderItem(root, true)}
      {thread.replies.length > 0 && (
        <button
          type="button"
          className="collab-link collab-replies-toggle"
          aria-expanded={p.expanded}
          aria-controls={ids.replies}
          onClick={() => p.onToggleExpanded(thread.id)}
        >
          {format(strings.collabReplyCount ?? '', { count: thread.replies.length })}
        </button>
      )}
      {thread.replies.length > 0 && (
        <ul id={ids.replies} role="list" className="collab-replies" hidden={!p.expanded}>
          {p.expanded &&
            thread.replies.map((r) => (
              <li
                key={r.id}
                role="listitem"
                aria-labelledby={r.deleted_at ? `${base}d-${r.id}` : `${base}a-${r.id}`}
              >
                {renderItem(r, false)}
              </li>
            ))}
        </ul>
      )}
      {failed && (
        <p className="collab-why collab-why--err" role="alert">
          {strings.collabActionFailed}
        </p>
      )}
      {showComposer && (
        <div className="collab-comp-slot">
          {p.renderComposer!({
            host,
            source: p.source,
            mode: 'reply',
            draftKey: `reply:${thread.id}`,
            ...(p.status
              ? { disabledReason: 'status' as const, statusLineId: p.statusLineId }
              : {}),
            autoFocus: true,
            onSubmit: async (body) => {
              await actions.reply(thread.id, body)
              restoreReplyRef.current = true
              setReplyOpen(false)
            },
            onCancel: () => {
              restoreReplyRef.current = true
              setReplyOpen(false)
              replyBtnRef.current?.focus()
            },
          })}
        </div>
      )}
      {conflict && (
        <div className="collab-tdel" role="alert">
          <span>
            {host.kind === 'discussion'
              ? strings.collabDiscussionDeleted
              : strings.collabCommentDeleted}
          </span>
          <button type="button" className="collab-btn" onClick={() => copyText(conflict.body)}>
            {strings.collabCopyText}
          </button>
        </div>
      )}
    </li>
  )
}

export const CollabThread = memo(CollabThreadImpl)
