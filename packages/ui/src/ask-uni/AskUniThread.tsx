import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  AskUniMessage,
  AskUniMessagesResult,
  AskUniV2ErrorCode,
} from '@genoffice/ai-provider/askuni'
import type { AskUniStringKey } from '../strings-ask-uni'
import { useAskUniAdapter, type AskUniFeedbackApi } from './adapter'
import { AskUniTurn, type AskUniTurnMessage } from './AskUniAnswer'
import type { AskUniStreamHandle } from './use-ask-uni-stream'
import './ask-uni.css'

export type { AskUniStreamHandle }

export interface AskUniThreadProps {
  /** Home's workspace: a different one reloads. Left out in an editor, which has one document */
  workspaceId?: string
  /** null = a new conversation (nothing stored yet; the live turn shows until `run` names it) */
  conversationId: string | null
  /** the stored messages of a conversation; a failed load keeps what is shown. Defaults to the adapter's */
  loadMessages?: (conversationId: string) => Promise<AskUniMessagesResult | AskUniMessage[]>
  stream: AskUniStreamHandle
  /** the panel resends this question (the last stored one) in the same conversation */
  onRegenerate: (question: string) => void
  /** defaults to the adapter's feedback calls */
  onFeedback?: AskUniFeedbackApi
  /**
   * The host's one polite live region (an editor panel has exactly one): the turn status goes
   * there, and the thread renders no region of its own. It is cleared when the thread goes away.
   */
  onStatus?: ((text: string) => void) | undefined
}

/** the reader counts as "at the bottom" within this many pixels */
const NEAR_BOTTOM_PX = 80

const ERROR_KEYS: Partial<Record<AskUniV2ErrorCode, AskUniStringKey>> = {
  forbidden: 'askUniErrForbidden',
  quota: 'askUniErrQuota',
  rate_limited: 'askUniErrRateLimited',
  disabled: 'askUniErrDisabled',
  offline: 'askUniErrOffline',
  session: 'askUniErrSession',
  signed_out: 'askUniSignedOut',
  error: 'askUniErrDefault',
  provider_error: 'askUniV2ErrProviderError',
  provider_timeout: 'askUniV2ErrProviderTimeout',
  output_invalid: 'askUniV2ErrOutputInvalid',
  tool_not_allowed: 'askUniV2ErrToolNotAllowed',
  refused: 'askUniV2ErrRefused',
  cancelled: 'askUniV2ErrCancelled',
  stream_ended: 'askUniV2ErrStreamEnded',
}
/** asking again would fail the same way: no retry button */
const NO_RETRY: ReadonlySet<string> = new Set([
  'signed_out',
  'session',
  'disabled',
  'forbidden',
  'quota',
])

/**
 * The scrollable message area of Ask UNI: the stored turns of the conversation, then the live
 * question and answer until a reload holds them. The header and the composer belong to the panel.
 */
export function AskUniThread({
  workspaceId = '',
  conversationId,
  loadMessages,
  stream,
  onRegenerate,
  onFeedback,
  onStatus,
}: AskUniThreadProps): ReactElement {
  const adapter = useAskUniAdapter()
  const { t } = adapter
  const { state } = stream
  const [stored, setStored] = useState<AskUniMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  // the first load of a stored conversation failed (a later reload that fails keeps what is shown)
  const [loadFailed, setLoadFailed] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const loadRef = useRef(loadMessages ?? ((id: string) => adapter.loadMessages(id)))
  loadRef.current = loadMessages ?? ((id: string) => adapter.loadMessages(id))
  const loadedFor = useRef<string | null>(null)

  // load on a new conversation or workspace, and again whenever the stream says the store changed
  useEffect(() => {
    const scope = `${workspaceId}/${conversationId ?? ''}`
    if (loadedFor.current !== scope) {
      loadedFor.current = scope
      setStored([])
      setLoaded(false)
    }
    setLoadFailed(false)
    if (conversationId === null) return
    let alive = true
    loadRef
      .current(conversationId)
      .then(
        (res) => (Array.isArray(res) ? res : res.ok ? res.messages : null),
        () => null,
      )
      .then((messages) => {
        if (!alive) return
        if (messages === null) {
          setLoadFailed(true)
          return
        }
        setStored(messages)
        setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [workspaceId, conversationId, state.reloadTick, retryTick])

  const streaming = state.status === 'streaming'
  // how many stored turns there were when the live turn started (null until the history has loaded)
  const [base, setBase] = useState<number | null>(null)
  useEffect(() => {
    if (streaming) setBase(conversationId === null ? 0 : loaded ? stored.length : null)
    // only a new question starts a turn; later loads must not move the base
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, state.question])
  useEffect(() => {
    if (base === null && loaded && state.status !== 'idle') setBase(stored.length)
  }, [base, loaded, stored.length, state.status])

  // the content match is only for a thread that mounted with the turn already stopped; a turn stopped while mounted
  // is told apart by the count above (the same question asked again would match the previous stopped turn)
  const mountedStopped = useRef(state.status === 'stopped')
  useEffect(() => {
    if (streaming) mountedStopped.current = false
  }, [streaming, state.question])

  const inStore = state.message ? stored.some((m) => m.id === state.message?.id) : false
  // a stopped turn has no message of its own: it is stored once the history grew by its question and partial answer,
  // or, for a thread mounted after that (the dock was collapsed and expanded), when the history already ends with them
  const storedEnd = stored.slice(-2)
  const storedStopped =
    state.status === 'stopped' &&
    !state.message &&
    ((base !== null && stored.length >= base + 2) ||
      (mountedStopped.current &&
        storedEnd.length === 2 &&
        storedEnd[0]?.role === 'user' &&
        storedEnd[0].content === state.question &&
        storedEnd[1]?.role === 'assistant' &&
        storedEnd[1].notice === 'stopped'))
  const sameConversation = state.conversationId === conversationId
  const live = state.status !== 'idle' && sameConversation && !inStore && !storedStopped

  // a stored conversation that has not loaded yet: busy while it loads, an error with Retry if it failed
  const firstLoad = conversationId !== null && !loaded && !live
  const loading = firstLoad && !loadFailed

  const lastAssistant = [...stored]
    .reverse()
    .find((m) => m.role === 'assistant' && !m.id.startsWith('pending-'))
  const lastQuestion = [...stored].reverse().find((m) => m.role === 'user')?.content ?? ''
  // a finished live turn carries the regenerate itself; while one runs the stored one shows disabled
  const canRegenerate = lastQuestion !== '' && !(live && state.status !== 'streaming')

  // follow the answer as it grows, but only while the reader is at the bottom
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const onScroll = () => {
    const el = scroller.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }
  useEffect(() => {
    if (streaming) pinned.current = true
  }, [streaming, state.question])
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [stored.length, state.draft, state.status, state.counts, live])

  const errorText = (): string => {
    const code = state.errorCode
    if (code === 'rate_limited' && state.retryAfterSeconds && state.retryAfterSeconds > 0) {
      return t('askUniErrRateLimitedIn', { seconds: String(Math.ceil(state.retryAfterSeconds)) })
    }
    return t((code && ERROR_KEYS[code]) || 'askUniErrDefault')
  }

  // the one polite live region: the turn status, never every delta of the answer
  let status = ''
  if (sameConversation) {
    if (state.status === 'streaming') status = t('askUniThinking')
    else if (state.status === 'done') status = t('askUniV2AnswerReady')
    else if (state.status === 'stopped') status = t('askUniV2NoticeStopped')
    else if (state.status === 'error') status = errorText()
  }

  // an editor panel owns the one live region: hand it the status, and clear it with the thread
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus
  useEffect(() => {
    statusRef.current?.(status)
  }, [status])
  useEffect(() => () => statusRef.current?.(''), [])

  const liveMessage: AskUniTurnMessage = {
    id: state.message?.id ?? 'live',
    role: 'assistant',
    content: state.message?.content ?? state.draft,
    citations: state.message?.citations ?? state.citations,
    ...(state.message?.notice
      ? { notice: state.message.notice }
      : state.status === 'stopped'
        ? { notice: 'stopped' as const }
        : {}),
  }
  const showLiveAnswer =
    streaming || state.message !== null || state.draft !== '' || state.status === 'stopped'
  const liveFinished = state.status === 'done' || state.status === 'stopped'

  return (
    <div ref={scroller} onScroll={onScroll} className="askuni-v2-thread">
      {onStatus ? null : (
        <p className="askuni-v2-sr" aria-live="polite" aria-atomic="true">
          {status}
        </p>
      )}
      <ul className="askuni-v2-turns" aria-busy={streaming || loading}>
        {stored.map((m) => (
          <AskUniTurn
            key={m.id}
            message={m}
            conversationId={conversationId}
            onRegenerate={
              canRegenerate && m.id === lastAssistant?.id
                ? () => onRegenerate(lastQuestion)
                : undefined
            }
            regenerateDisabled={streaming}
            feedback={onFeedback}
          />
        ))}
        {firstLoad && loadFailed ? (
          <li className="askuni-v2-error" role="alert">
            <p>{t('askUniErrDefault')}</p>
            <button
              type="button"
              className="askuni-v2-retry"
              onClick={() => setRetryTick((n) => n + 1)}
            >
              {t('askUniV2Retry')}
            </button>
          </li>
        ) : null}
        {live ? (
          <>
            <AskUniTurn
              message={{
                id: 'live-question',
                role: 'user',
                content: state.question,
                citations: [],
              }}
            />
            {showLiveAnswer ? (
              <AskUniTurn
                message={liveMessage}
                streaming={streaming}
                conversationId={conversationId}
                counts={state.counts}
                onRegenerate={liveFinished ? () => onRegenerate(state.question) : undefined}
                feedback={onFeedback}
              />
            ) : null}
            {state.status === 'error' ? (
              <li className="askuni-v2-error">
                <p>{errorText()}</p>
                {state.errorCode && NO_RETRY.has(state.errorCode) ? null : (
                  <button type="button" className="askuni-v2-retry" onClick={stream.retry}>
                    {t('askUniV2Retry')}
                  </button>
                )}
              </li>
            ) : null}
          </>
        ) : null}
      </ul>
    </div>
  )
}
