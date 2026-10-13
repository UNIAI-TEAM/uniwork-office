/**
 * The S12 (comments) / S13 (Discussion) panel shell: header (title, view-only badge, close), the one-line
 * status line, the thread list in anchor or time order, the collapsed "Resolved" group, the F-only
 * "Comments in the file" slot, and the Discussion composer at the bottom. The host owns the controller
 * (`useCollabThreads`) so it can call `reload()` / `reveal()`; this component only renders it.
 *
 * Focus (Accessibility Floor G8): a reload never moves focus; a reveal focuses the thread heading (or the
 * deleted frame / the notice line); a focused thread that disappears hands focus to the next thread, else
 * the panel title; resolve / reopen keeps focus on the same button after the thread moves group.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { format } from '@genoffice/i18n'
import { announcePolite } from './live-region'
import {
  CollabThread,
  defaultRenderAnchor,
  type CollabAnchorSlot,
  type CollabRenderAnchor,
  type CollabRenderBody,
  type CollabRenderComposer,
} from './CollabThread'
import {
  collabInsertIndex,
  type CollabController,
  type CollabStrings,
  type CollabThreadView,
} from './use-collab-threads'

export interface CollabInFileSlot {
  /** number of in-file threads; the section is drawn only when > 0 */
  count: number
  content: ReactNode
}

export interface CollabPanelProps {
  controller: CollabController
  strings: CollabStrings
  /** absent: no close button (e.g. a tab of a larger panel) */
  onClose?(): void
  renderBody?: CollabRenderBody
  renderAnchor?: CollabRenderAnchor
  renderComposer?: CollabRenderComposer
  /** F only, comment kind only */
  inFile?: CollabInFileSlot
  formatTime?(iso: string | undefined): string
  className?: string
}

function cssEscape(v: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&')
}

function Skeleton() {
  return (
    <div className="collab-skelwrap" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="collab-skelc">
          <span className="collab-skel" style={{ width: '40%' }} />
          <span className="collab-skel" style={{ width: '90%' }} />
          <span className="collab-skel" style={{ width: '70%' }} />
        </div>
      ))}
    </div>
  )
}

export function CollabPanel(p: CollabPanelProps) {
  const { controller: ctl, strings } = p
  const { host } = ctl
  const base = useId()
  const titleId = `${base}t`
  const statusId = `${base}s`
  const resolvedListId = `${base}rg`
  const inFileId = `${base}if`
  const [inFileOpen, setInFileOpen] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  /** the thread focus was last inside, and the visible order at that moment */
  const focusedRef = useRef<{ id: string; order: string[] } | null>(null)
  const keepFocusRef = useRef<string | null>(null)

  const title = host.kind === 'discussion' ? strings.collabDiscussion : strings.collabComments
  const visible: CollabThreadView[] = ctl.resolvedOpen
    ? [...ctl.threads, ...ctl.resolved]
    : ctl.threads
  const visibleIds = visible.map((t) => t.id)

  // the status line: S15 notice first, then the connection status, then view-only
  const lineKey: string | null = ctl.notice
    ? ctl.notice === 'discussionDeleted'
      ? 'collabDiscussionDeleted'
      : 'collabCommentDeleted'
    : ctl.status
      ? ctl.status === 'offline'
        ? 'collabOffline'
        : ctl.status === 'signedOut'
          ? 'collabSignedOut'
          : 'collabServerError'
      : ctl.viewOnly && ctl.state === 'ready'
        ? 'collabViewOnly'
        : null
  const lineText = lineKey ? (strings[lineKey] ?? '') : ''
  const lineTone = ctl.status && !ctl.notice ? 'warn' : 'plain'

  // the visible line is the on-screen copy; the sentence goes to the window's polite region once per change
  useEffect(() => {
    if (lineText) announcePolite(lineText)
  }, [lineText])

  // reveal: focus the requested target once per request
  const focusSeq = ctl.focus?.seq
  useEffect(() => {
    const req = ctl.focus
    if (!req) return
    let el: HTMLElement | null = null
    if (req.target === 'notice') el = noticeRef.current
    else if (req.threadId) {
      const item = asideRef.current?.querySelector<HTMLElement>(
        `[data-thread-id="${cssEscape(req.threadId)}"]`,
      )
      el =
        req.target === 'deleted' && req.commentId
          ? (item?.querySelector<HTMLElement>(`[data-deleted-for="${cssEscape(req.commentId)}"]`) ??
            null)
          : null
      el ??= item?.querySelector<HTMLElement>('[data-thread-heading]') ?? null
    }
    if (!el) return
    el.focus()
    el.scrollIntoView?.({ block: 'nearest' })
    // only the sequence number decides a new request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq])

  // a reload replaced the list: keep focus where it was, or move it to the next thread if it vanished
  const visibleKey = visibleIds.join('\u0000')
  useLayoutEffect(() => {
    const keep = keepFocusRef.current
    if (keep) {
      const btn = asideRef.current?.querySelector<HTMLElement>(
        `[data-resolve-for="${cssEscape(keep)}"]`,
      )
      if (btn && document.activeElement !== btn) {
        const active = document.activeElement
        if (!active || active === document.body || !asideRef.current?.contains(active)) {
          btn.focus()
          keepFocusRef.current = null
          return
        }
      }
      if (btn && document.activeElement === btn) keepFocusRef.current = null
    }
    const was = focusedRef.current
    if (!was || visibleIds.includes(was.id)) return
    const active = document.activeElement
    if (active && active !== document.body && asideRef.current?.contains(active)) return
    if (active && active !== document.body) return
    const at = was.order.indexOf(was.id)
    const nextId =
      was.order.slice(at + 1).find((id) => visibleIds.includes(id)) ??
      [...was.order.slice(0, at)].reverse().find((id) => visibleIds.includes(id))
    const next = nextId
      ? asideRef.current?.querySelector<HTMLElement>(
          `[data-thread-id="${cssEscape(nextId)}"] [data-thread-heading]`,
        )
      : null
    focusedRef.current = null
    ;(next ?? titleRef.current)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey])

  const onFocusCapture = (e: React.FocusEvent) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-thread-id]')
    const id = item?.dataset.threadId
    if (id) focusedRef.current = { id, order: visibleIds }
  }

  const renderThread = (t: CollabThreadView) => (
    <CollabThread
      key={t.id}
      thread={t}
      host={host}
      source={ctl.source}
      strings={strings}
      can={ctl.can}
      actions={ctl.actions}
      mentions={ctl.mentions}
      expanded={ctl.isExpanded(t)}
      onToggleExpanded={ctl.toggleExpanded}
      status={ctl.status}
      statusLineId={lineKey ? statusId : undefined}
      conflict={ctl.conflict}
      adapter={ctl.adapter}
      renderBody={p.renderBody}
      renderAnchor={p.renderAnchor}
      renderComposer={p.renderComposer}
      formatTime={p.formatTime}
      onKeepFocus={keepFocus}
    />
  )

  const disabled = ctl.status ? { disabledReason: 'status' as const, statusLineId: statusId } : {}

  const newThreadItem = (() => {
    const nt = ctl.newThread
    if (!nt || host.kind !== 'comment' || !ctl.can.canWrite || !p.renderComposer) return null
    const labelId = `${base}nl`
    const slot: CollabAnchorSlot = {
      anchor: nt.anchor,
      labelId,
      stateId: `${base}ns`,
      host,
      adapter: ctl.adapter,
    }
    return (
      <li
        key="__new"
        role="listitem"
        className="collab-thread collab-thread--new"
        aria-labelledby={labelId}
      >
        <div className="collab-th collab-th--new">
          <span className="collab-al">
            {p.renderAnchor ? p.renderAnchor(slot) : defaultRenderAnchor(slot, strings)}
          </span>
        </div>
        <div className="collab-comp-slot">
          {p.renderComposer({
            host,
            source: ctl.source,
            mode: 'root',
            draftKey: `root:${JSON.stringify(nt.anchor)}`,
            ...disabled,
            autoFocus: true,
            onSubmit: (body) => ctl.actions.create(body, nt),
            onCancel: ctl.cancelThread,
          })}
        </div>
      </li>
    )
  })()

  const openItems: ReactNode[] = ctl.threads.map(renderThread)
  if (newThreadItem) {
    openItems.splice(
      collabInsertIndex(ctl.threads, ctl.newThread!.anchor, ctl.adapter),
      0,
      newThreadItem,
    )
  }

  let body: ReactNode
  if (ctl.state === 'loading') {
    body = (
      <>
        <Skeleton />
        <p className="collab-sr">{strings.collabLoading}</p>
      </>
    )
  } else if (ctl.state === 'loadError') {
    body = (
      <div className="collab-msg">
        <p className="collab-msg-title">{strings.collabLoadError}</p>
        <p className="collab-msg-body">{strings.collabLoadErrorBody}</p>
        <button type="button" className="collab-btn" onClick={() => void ctl.retry()}>
          {strings.collabRetry}
        </button>
      </div>
    )
  } else if (ctl.state === 'noAccess') {
    body = (
      <div className="collab-msg">
        <p className="collab-msg-title">{strings.collabNoAccess}</p>
        <p className="collab-msg-body">{strings.collabNoAccessBody}</p>
      </div>
    )
  } else {
    const empty = ctl.threads.length === 0 && ctl.resolved.length === 0 && !newThreadItem
    body = (
      <div className="collab-scroll" onFocusCapture={onFocusCapture}>
        {empty && (
          <p className="collab-empty">
            {host.kind === 'discussion'
              ? strings.collabEmptyDiscussion
              : strings.collabEmptyComments}
          </p>
        )}
        {openItems.length > 0 && (
          <ul role="list" className="collab-list">
            {openItems}
          </ul>
        )}
        {ctl.resolved.length > 0 && (
          <div className="collab-group">
            <button
              type="button"
              className="collab-group-toggle"
              aria-expanded={ctl.resolvedOpen}
              aria-controls={resolvedListId}
              onClick={() => ctl.setResolvedOpen(!ctl.resolvedOpen)}
            >
              <span className="collab-caret" aria-hidden="true" />
              {format(strings.collabLabelCount ?? '', {
                label: strings.collabResolved ?? '',
                count: ctl.resolved.length,
              })}
            </button>
            <ul
              id={resolvedListId}
              role="list"
              className="collab-list collab-list--resolved"
              hidden={!ctl.resolvedOpen}
            >
              {ctl.resolvedOpen && ctl.resolved.map(renderThread)}
            </ul>
          </div>
        )}
        {host.kind === 'comment' && p.inFile && p.inFile.count > 0 && (
          <div className="collab-group collab-group--infile">
            <button
              type="button"
              className="collab-group-toggle"
              aria-expanded={inFileOpen}
              aria-controls={inFileId}
              onClick={() => setInFileOpen((o) => !o)}
            >
              <span className="collab-caret" aria-hidden="true" />
              {format(strings.collabLabelCount ?? '', {
                label: strings.collabInFileSection ?? '',
                count: p.inFile.count,
              })}
            </button>
            <div id={inFileId} className="collab-infile" hidden={!inFileOpen}>
              {inFileOpen && (
                <>
                  <p className="collab-cap">{strings.collabInFileHint}</p>
                  {p.inFile.content}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  function keepFocus(threadId: string) {
    keepFocusRef.current = threadId
  }

  return (
    <aside
      ref={asideRef}
      className={['collab-panel', p.className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      aria-busy={ctl.state === 'loading' || undefined}
      lang={host.lang}
    >
      <div className="collab-ph">
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="collab-title">
          {title}
        </h2>
        {ctl.viewOnly && ctl.state === 'ready' && (
          <span className="collab-badge">{strings.collabViewOnlyBadge}</span>
        )}
        {p.onClose && (
          <button
            type="button"
            className="collab-ico collab-close"
            aria-label={format(strings.collabClosePanel ?? '', { panel: title ?? '' })}
            onClick={p.onClose}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        )}
      </div>
      {lineKey && (
        <p
          id={statusId}
          ref={noticeRef}
          className={`collab-pnote collab-pnote--${lineTone}`}
          tabIndex={ctl.notice ? -1 : undefined}
        >
          {lineText}
        </p>
      )}
      {body}
      {ctl.state === 'ready' &&
        host.kind === 'discussion' &&
        ctl.can.canWrite &&
        p.renderComposer && (
          <div className="collab-comp-root">
            {p.renderComposer({
              host,
              source: ctl.source,
              mode: 'discussion',
              draftKey: 'discussion',
              ...disabled,
              onSubmit: (body) => ctl.actions.create(body),
              onCancel: () => {},
            })}
          </div>
        )}
    </aside>
  )
}
