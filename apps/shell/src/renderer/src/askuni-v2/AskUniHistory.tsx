import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { WbConfirm } from '../WbConfirm'
import { useI18n } from '../locale'
import {
  ASKUNI_MAX_TITLE,
  type AskUniConversation,
  type AskUniOkResult,
} from '../../../shared/askuni-api'
import { frameBridge } from './frame-bridge'
import { usePopoverDismiss } from './frame-popover'

export interface AskUniConversationsApi {
  status: 'loading' | 'ready' | 'failed'
  items: AskUniConversation[]
  reload: () => void
  /** true when the server accepted the new title (the list shows it at once) */
  rename: (id: string, title: string) => Promise<boolean>
  /** true when the server deleted it (the row is gone at once) */
  remove: (id: string) => Promise<boolean>
}

/** the workspace's latest conversations from the server; `refreshKey` bumps reload it (a turn ended) */
export function useAskUniConversations(
  workspaceId: string,
  refreshKey = 0,
): AskUniConversationsApi {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'failed'
    items: AskUniConversation[]
  }>({ status: 'loading', items: [] })
  const [retryKey, setRetryKey] = useState(0)
  const workspaceRef = useRef(workspaceId)

  useEffect(() => {
    let alive = true
    // another workspace's list is never shown; a refresh of the same one keeps the rows meanwhile
    if (workspaceRef.current !== workspaceId) {
      workspaceRef.current = workspaceId
      setState({ status: 'loading', items: [] })
    } else {
      setState((s) => (s.status === 'ready' ? s : { status: 'loading', items: s.items }))
    }
    const call = frameBridge().askUniConversations
    if (!call) {
      setState({ status: 'failed', items: [] })
      return
    }
    call({ workspaceId }).then(
      (r) => {
        if (!alive) return
        setState((s) =>
          r.ok ? { status: 'ready', items: r.conversations } : { status: 'failed', items: s.items },
        )
      },
      () => {
        if (alive) setState((s) => ({ status: 'failed', items: s.items }))
      },
    )
    return () => {
      alive = false
    }
  }, [workspaceId, refreshKey, retryKey])

  const reload = useCallback(() => setRetryKey((k) => k + 1), [])

  const rename = useCallback(async (id: string, title: string): Promise<boolean> => {
    let r: AskUniOkResult
    try {
      const call = frameBridge().askUniRename
      r = call ? await call({ conversationId: id, title }) : { ok: false, error: 'error' }
    } catch {
      return false
    }
    if (r.ok) {
      setState((s) => ({
        ...s,
        items: s.items.map((c) => (c.id === id ? { ...c, title } : c)),
      }))
    }
    return r.ok
  }, [])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    let r: AskUniOkResult
    try {
      const call = frameBridge().askUniDelete
      r = call ? await call({ conversationId: id }) : { ok: false, error: 'error' }
    } catch {
      return false
    }
    if (r.ok) setState((s) => ({ ...s, items: s.items.filter((c) => c.id !== id) }))
    return r.ok
  }, [])

  return { ...state, reload, rename, remove }
}

function RenameField({
  conversation,
  onSave,
  onDone,
}: {
  conversation: AskUniConversation
  onSave: (title: string) => Promise<boolean>
  onDone: () => void
}): ReactElement {
  const { t } = useI18n()
  const [value, setValue] = useState(conversation.title)
  const savingRef = useRef(false)
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // an IME commits its syllable on Enter; that keydown must not save
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onDone()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (savingRef.current) return
      const title = value.trim()
      if (!title || title === conversation.title) return onDone()
      savingRef.current = true
      void onSave(title).then((ok) => {
        savingRef.current = false
        if (ok) onDone()
      })
    }
  }
  return (
    <input
      autoFocus
      className="askuni2-rename"
      aria-label={t('askUniV2RenameConversation')}
      value={value}
      maxLength={ASKUNI_MAX_TITLE}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}

function Chevron(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

/** The conversation title as a button that opens the history: open, rename inline, delete after a confirmation. */
export function AskUniHistory({
  title,
  activeId,
  conversations,
  onSelect,
}: {
  title: string
  activeId: string | null
  conversations: AskUniConversationsApi
  /** null = start a new conversation (the open one was deleted) */
  onSelect: (id: string | null) => void
}): ReactElement {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AskUniConversation | null>(null)
  const [problem, setProblem] = useState<'rename' | 'delete' | null>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    setRenamingId(null)
    setProblem(null)
  }
  usePopoverDismiss(open, close, anchorRef, popRef)
  const { status, items } = conversations

  // ↑/↓ move between the rows' open buttons
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const picks = Array.from(
      popRef.current?.querySelectorAll<HTMLElement>('[data-role="open"]') ?? [],
    )
    const at = picks.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    e.preventDefault()
    picks[(at + (e.key === 'ArrowDown' ? 1 : -1) + picks.length) % picks.length]?.focus()
  }

  return (
    <>
      <span className="askuni2-history">
        <button
          ref={anchorRef}
          type="button"
          className="askuni2-title-btn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t('askUniV2HistoryWith', { title })}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <span className="askuni2-title-text">{title}</span>
          <Chevron />
        </button>
        {open ? (
          <div
            ref={popRef}
            role="dialog"
            className="askuni2-popover askuni2-history-pop"
            data-slot="askuni-history"
            aria-label={t('askUniV2History')}
            onKeyDown={onKeyDown}
          >
            {problem ? (
              <p role="alert" className="askuni2-notice-error">
                {problem === 'rename' ? t('askUniV2RenameFailed') : t('askUniV2DeleteFailed')}
              </p>
            ) : null}
            {status === 'loading' && items.length === 0 ? (
              <p className="askuni2-note">{t('askUniLoading')}</p>
            ) : status === 'failed' && items.length === 0 ? (
              <div className="askuni2-history-failed">
                <p className="askuni2-note">{t('askUniV2HistoryFailed')}</p>
                <button
                  type="button"
                  className="new-chat-ghost-btn"
                  data-action="retry"
                  onClick={conversations.reload}
                >
                  {t('setRetry')}
                </button>
              </div>
            ) : items.length === 0 ? (
              <p className="askuni2-note">{t('askUniV2HistoryEmpty')}</p>
            ) : (
              <ul className="askuni2-history-list" aria-label={t('askUniV2History')}>
                {items.map((c) => (
                  <li key={c.id} className="askuni2-history-row">
                    {renamingId === c.id ? (
                      <RenameField
                        conversation={c}
                        onSave={async (next) => {
                          const ok = await conversations.rename(c.id, next)
                          setProblem(ok ? null : 'rename')
                          return ok
                        }}
                        onDone={() => setRenamingId(null)}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          data-role="open"
                          className={`askuni2-history-open${c.id === activeId ? ' is-current' : ''}`}
                          aria-current={c.id === activeId ? 'true' : undefined}
                          onClick={() => {
                            onSelect(c.id)
                            close()
                          }}
                        >
                          <span className="askuni2-history-title">
                            {c.title || t('askUniV2Untitled')}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="askuni2-icon-btn"
                          aria-label={t('askUniV2RenameConversation')}
                          onClick={() => {
                            setProblem(null)
                            setRenamingId(c.id)
                          }}
                        >
                          <svg
                            viewBox="0 0 16 16"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="m10.5 3.5 2 2L6 12l-2.8.8L4 10z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="askuni2-icon-btn"
                          aria-label={t('askUniV2DeleteConversation')}
                          onClick={() => {
                            setProblem(null)
                            setDeleting(c)
                          }}
                        >
                          <svg
                            viewBox="0 0 16 16"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8" />
                          </svg>
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </span>
      {deleting ? (
        <WbConfirm
          title={t('askUniV2DeleteConfirmTitle')}
          body={t('askUniV2DeleteConfirmDescription')}
          confirmLabel={t('askUniV2DeleteConfirm')}
          cancelLabel={t('askUniV2DeleteCancel')}
          tone="danger"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const target = deleting
            setDeleting(null)
            void conversations.remove(target.id).then((ok) => {
              if (!ok) {
                setProblem('delete')
                return
              }
              if (target.id === activeId) onSelect(null)
              // the row that held focus is gone
              anchorRef.current?.focus()
            })
          }}
        />
      ) : null}
    </>
  )
}
