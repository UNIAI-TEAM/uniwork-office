import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { IconSend, IconStop, Markdown } from '@genoffice/ui'
import '@genoffice/ui/markdown.css'
import './askuni.css'
import { useI18n, type StringKey } from './locale'
import type {
  AskUniBridge,
  AskUniCitation,
  AskUniCitationKind,
  AskUniContext,
  AskUniErrorCode,
  AskUniNotice,
  AskUniResult,
} from '../../shared/askuni-api'

const MAX_QUESTION = 2000
/** the counter only shows near the cap, so a short question stays uncluttered */
const COUNTER_FROM = 1800

type Turn =
  | { id: number; kind: 'user'; text: string }
  | {
      id: number
      kind: 'answer'
      content: string
      notice: AskUniNotice | undefined
      citations: AskUniCitation[]
    }
  | { id: number; kind: 'error'; code: AskUniErrorCode; retryAfterSec: number | undefined }
  | { id: number; kind: 'stopped' }

type ContextState =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; ctx: AskUniContext }

const KIND_KEYS: Record<AskUniCitationKind, StringKey> = {
  document: 'askUniKindDocument',
  task: 'askUniKindTask',
  meeting: 'askUniKindMeeting',
  chat: 'askUniKindChat',
  member: 'askUniKindMember',
  other: 'askUniKindOther',
}

const ERROR_KEYS: Record<Exclude<AskUniErrorCode, 'signed_out'>, StringKey> = {
  forbidden: 'askUniErrForbidden',
  quota: 'askUniErrQuota',
  rate_limited: 'askUniErrRateLimited',
  disabled: 'askUniErrDisabled',
  offline: 'askUniErrOffline',
  session: 'askUniErrSession',
  error: 'askUniErrDefault',
}

function bridge(): Partial<AskUniBridge> {
  return window.aiOffice as unknown as Partial<AskUniBridge>
}

/** whether the shell preload exposes Ask UNI (the Home hides the mode toggle otherwise) */
export function hasAskUniBridge(): boolean {
  const b = bridge()
  return typeof b.uniworkAskUni === 'function' && typeof b.uniworkAskUniContext === 'function'
}

/** a kind this build has no row for (an older app against a newer server) shows as the generic row */
function knownKind(kind: string): AskUniCitationKind {
  return Object.prototype.hasOwnProperty.call(KIND_KEYS, kind)
    ? (kind as AskUniCitationKind)
    : 'other'
}

function KindIcon({ kind }: { kind: AskUniCitationKind }): ReactElement {
  const paths: Record<AskUniCitationKind, ReactElement> = {
    document: (
      <>
        <path d="M4.5 2.5h4.8l2.7 2.7v8.3h-7.5z" />
        <path d="M9.3 2.5v2.7H12M6 8.5h4M6 11h4" />
      </>
    ),
    task: (
      <>
        <rect x="3" y="3" width="10" height="10" rx="2" />
        <path d="m5.8 8.2 1.6 1.6 3-3.2" />
      </>
    ),
    meeting: (
      <>
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
        <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
      </>
    ),
    chat: (
      <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11h-.5A.5.5 0 0 1 3 10.5z" />
    ),
    member: (
      <>
        <circle cx="8" cy="5.8" r="2.3" />
        <path d="M3.5 13c.5-2.3 2.2-3.4 4.5-3.4s4 1.1 4.5 3.4" />
      </>
    ),
    other: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M5.5 8h.01M8 8h.01M10.5 8h.01" />
      </>
    ),
  }
  return (
    <svg
      className="askuni-source-icon"
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
      {paths[kind]}
    </svg>
  )
}

/**
 * Ask UNI: the workspace-level question mode of the Home My AI pane. One conversation per
 * session (the id from the server is kept across turns, New chat drops it); the answer renders
 * as safe Markdown with a Sources list under it. The Home keeps the pane mounted while the chat
 * mode is on (`visible` false), so the turns, conversation and draft survive the switch.
 */
export function AskUniPane({ visible = true }: { visible?: boolean }): ReactElement {
  const { t, lang } = useI18n()
  const [context, setContext] = useState<ContextState>({ status: 'loading' })
  const [pickedWorkspace, setPickedWorkspace] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const conversationRef = useRef<string | undefined>(undefined)
  // bumped by Stop, New chat and a workspace switch: an answer for an older request is dropped
  const requestRef = useRef(0)
  const turnIdRef = useRef(0)

  useEffect(() => {
    let alive = true
    const b = bridge()
    if (!b.uniworkAskUniContext) {
      setContext({ status: 'failed' })
      return
    }
    b.uniworkAskUniContext().then(
      (ctx) => {
        if (alive) setContext({ status: 'ready', ctx })
      },
      () => {
        if (alive) setContext({ status: 'failed' })
      },
    )
    return () => {
      alive = false
    }
  }, [reloadKey])

  const reloadContext = useCallback(() => {
    setSignedOut(false)
    setContext({ status: 'loading' })
    setReloadKey((k) => k + 1)
  }, [])

  // a sign-in done elsewhere is picked up when the pane comes back into view
  const needsReloadRef = useRef(false)
  needsReloadRef.current =
    context.status === 'failed' ||
    signedOut ||
    (context.status === 'ready' && !context.ctx.signedIn)
  const wasVisibleRef = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisibleRef.current && needsReloadRef.current) reloadContext()
    wasVisibleRef.current = visible
  }, [visible, reloadContext])

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' })
  }, [turns, pending])

  // the composer is disabled while an ask is pending: focus moves to Stop, and comes back to the
  // composer when the ask settles, unless the user has put it somewhere else meanwhile
  const wasPendingRef = useRef(false)
  useEffect(() => {
    if (pending && !wasPendingRef.current) {
      stopRef.current?.focus()
    } else if (!pending && wasPendingRef.current) {
      const active = document.activeElement
      if (!active || active === document.body || active === stopRef.current) {
        inputRef.current?.focus()
      }
    }
    wasPendingRef.current = pending
  }, [pending])

  const nextId = () => ++turnIdRef.current
  const ctx = context.status === 'ready' ? context.ctx : null
  const workspaces = ctx?.workspaces ?? []
  const workspaceId =
    workspaces.find((w) => w.id === pickedWorkspace)?.id ??
    workspaces.find((w) => w.id === ctx?.currentWorkspaceId)?.id ??
    workspaces[0]?.id ??
    null
  const workspaceName = workspaces.find((w) => w.id === workspaceId)?.name ?? ''

  const resetConversation = () => {
    requestRef.current += 1
    conversationRef.current = undefined
    setPending(false)
    setOpenFailed(false)
    setTurns([])
    setInput('')
  }

  const submit = async () => {
    const question = input.trim()
    const b = bridge()
    if (!question || pending || !workspaceId || !b.uniworkAskUni) return
    const request = ++requestRef.current
    setTurns((prev) => [...prev, { id: nextId(), kind: 'user', text: question }])
    setInput('')
    setOpenFailed(false)
    setPending(true)
    let result: AskUniResult
    try {
      result = await b.uniworkAskUni({
        workspaceId,
        conversationId: conversationRef.current,
        question,
        locale: lang === 'vi' ? 'vi' : 'en',
      })
    } catch {
      result = { ok: false, code: 'error' }
    }
    if (requestRef.current !== request) return
    setPending(false)
    if (result.ok) {
      conversationRef.current = result.conversationId
      const { content, citations, notice } = result.message
      setTurns((prev) => [...prev, { id: nextId(), kind: 'answer', content, notice, citations }])
      return
    }
    if (result.code === 'signed_out') setSignedOut(true)
    setTurns((prev) => [
      ...prev,
      { id: nextId(), kind: 'error', code: result.code, retryAfterSec: result.retryAfterSec },
    ])
    // the question comes back so a retry is one click, unless the user already typed something else
    setInput((current) => (current === '' ? question : current))
  }

  // main decides how a citation opens (a document in the app, else the web page) and refuses
  // anything it cannot place on the signed-in server; a refusal only shows the note
  const openCitation = async (c: AskUniCitation) => {
    const b = bridge()
    setOpenFailed(false)
    if (!b.uniworkAskUniOpenCitation) {
      setOpenFailed(true)
      return
    }
    try {
      const result = await b.uniworkAskUniOpenCitation({ kind: c.kind, href: c.href })
      if (!result.ok) setOpenFailed(true)
    } catch {
      setOpenFailed(true)
    }
  }

  const stop = () => {
    // the server call cannot be cancelled: its answer is dropped when it lands
    requestRef.current += 1
    setPending(false)
    setTurns((prev) => [...prev, { id: nextId(), kind: 'stopped' }])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // an IME commits its syllable on Enter; that keydown must not send
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const errorText = (turn: Extract<Turn, { kind: 'error' }>): string => {
    if (turn.code === 'signed_out') return t('askUniSignedOut')
    if (turn.code === 'rate_limited' && turn.retryAfterSec && turn.retryAfterSec > 0) {
      return t('askUniErrRateLimitedIn', { seconds: String(Math.ceil(turn.retryAfterSec)) })
    }
    return t(ERROR_KEYS[turn.code])
  }

  const answerText = (turn: Extract<Turn, { kind: 'answer' }>): string | null => {
    if (turn.content.trim() !== '') return null
    return turn.notice === 'no_sources' ? t('askUniNoticeNoSources') : t('askUniNoticeUnavailable')
  }

  let body: ReactElement
  if (context.status === 'loading') {
    body = <p className="askuni-note">{t('askUniLoading')}</p>
  } else if (context.status === 'failed') {
    body = (
      <div className="askuni-failed">
        <p className="askuni-note">{t('askUniErrDefault')}</p>
        <button type="button" className="new-chat-ghost-btn" onClick={reloadContext}>
          {t('setRetry')}
        </button>
      </div>
    )
  } else if (!ctx?.signedIn || signedOut) {
    body = <p className="askuni-note">{t('askUniSignedOut')}</p>
  } else if (!workspaceId) {
    body = <p className="askuni-note">{t('askUniNoWorkspace')}</p>
  } else {
    body = (
      <>
        <div className="askuni-context">
          {workspaces.length > 1 ? (
            <label className="askuni-workspace">
              <span className="askuni-workspace-label">{t('askUniWorkspace')}</span>
              <select
                className="askuni-workspace-select"
                value={workspaceId}
                onChange={(e) => {
                  setPickedWorkspace(e.target.value)
                  resetConversation()
                }}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="askuni-workspace">
              <span className="askuni-workspace-label">{t('askUniWorkspace')}</span>
              <span className="askuni-workspace-name">{workspaceName}</span>
            </p>
          )}
          {turns.length > 0 ? (
            <button type="button" className="new-chat-ghost-btn" onClick={resetConversation}>
              {t('askUniNewChat')}
            </button>
          ) : null}
        </div>

        <div className="new-chat-body askuni-body">
          <div className="new-chat-thread askuni-thread" aria-live="polite">
            {turns.length === 0 && !pending ? (
              <div className="askuni-empty">
                <h2 className="askuni-empty-title">{t('askUniEmptyTitle')}</h2>
                <p className="askuni-empty-text">{t('askUniEmptyDescription')}</p>
                <p className="askuni-empty-text">{t('askUniDescription')}</p>
              </div>
            ) : null}
            {turns.map((turn) => {
              if (turn.kind === 'user') {
                return (
                  <article key={turn.id} className="new-chat-msg is-user">
                    <span className="askuni-sr-only">{t('askUniYou')}: </span>
                    <p>{turn.text}</p>
                  </article>
                )
              }
              if (turn.kind === 'stopped') {
                return (
                  <p key={turn.id} className="askuni-note is-quiet">
                    {t('askUniStopped')}
                  </p>
                )
              }
              if (turn.kind === 'error') {
                return (
                  <article key={turn.id} className="new-chat-msg is-system is-error">
                    <p>{errorText(turn)}</p>
                  </article>
                )
              }
              const fallback = answerText(turn)
              return (
                <article key={turn.id} className="new-chat-msg is-assistant askuni-answer">
                  <span className="new-chat-msg-role">{t('askUniUni')}</span>
                  <div className="askuni-answer-body">
                    {fallback ? (
                      <p className="askuni-notice">{fallback}</p>
                    ) : (
                      <Markdown text={turn.content} />
                    )}
                  </div>
                  {turn.citations.length > 0 ? (
                    <section className="askuni-sources" aria-label={t('askUniSources')}>
                      <h3 className="askuni-sources-title">{t('askUniSources')}</h3>
                      <ul className="askuni-source-list">
                        {turn.citations.map((c, i) => {
                          const kind = knownKind(c.kind)
                          const action =
                            kind === 'document' ? t('askUniOpenDocument') : t('askUniOpenBrowser')
                          const body = (
                            <>
                              <KindIcon kind={kind} />
                              <span className="askuni-source-id" aria-hidden="true">
                                {c.sourceId}
                              </span>
                              <span className="askuni-source-text">
                                <span className="askuni-source-title">{c.title}</span>
                                {c.quote ? (
                                  <span className="askuni-source-quote">{c.quote}</span>
                                ) : null}
                              </span>
                            </>
                          )
                          // no server path to open (kind other without a page): a plain row, no action
                          if (c.href === '') {
                            return (
                              <li key={`${c.sourceId}-${i}`}>
                                <div className="askuni-source is-static" data-kind={kind}>
                                  {body}
                                </div>
                              </li>
                            )
                          }
                          return (
                            <li key={`${c.sourceId}-${i}`}>
                              <button
                                type="button"
                                className="askuni-source"
                                data-kind={kind}
                                aria-label={t('askUniCitationLabel', {
                                  kind: t(KIND_KEYS[kind]),
                                  title: c.title,
                                  action,
                                })}
                                onClick={() => void openCitation(c)}
                              >
                                {body}
                                <span className="askuni-source-action">{action}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ) : null}
                </article>
              )
            })}
            {pending ? <p className="askuni-note is-quiet">{t('askUniThinking')}</p> : null}
            {openFailed ? (
              <p className="askuni-note is-quiet askuni-open-note" role="status">
                {t('askUniOpenFailed')}
              </p>
            ) : null}
            <div ref={bottomRef} />
          </div>
        </div>

        <footer className="new-chat-composer askuni-composer">
          <div className="new-chat-composer-box">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={MAX_QUESTION}
              disabled={pending}
              aria-label={t('askUniPlaceholder')}
              placeholder={t('askUniPlaceholder')}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="new-chat-composer-actions">
              <span className="askuni-counter">
                {input.length >= COUNTER_FROM
                  ? t('askUniCounter', { used: String(input.length), max: String(MAX_QUESTION) })
                  : ''}
              </span>
              {pending ? (
                <button
                  // distinct keys: the Send button must not reuse the focused Stop node
                  key="stop"
                  ref={stopRef}
                  type="button"
                  className="new-chat-send is-stop"
                  onClick={stop}
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
                  disabled={input.trim() === ''}
                  onClick={() => void submit()}
                  title={t('askUniSend')}
                  aria-label={t('askUniSend')}
                >
                  <IconSend size={16} />
                </button>
              )}
            </div>
          </div>
        </footer>
      </>
    )
  }

  return (
    <section className="askuni-pane" aria-label={t('askUniTitle')} hidden={!visible}>
      {body}
    </section>
  )
}
