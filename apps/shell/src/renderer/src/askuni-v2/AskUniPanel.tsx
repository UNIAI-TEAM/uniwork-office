import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import './frame.css'
import { useI18n, type StringKey } from '../locale'
import type {
  AskUniFocusKind,
  AskUniMessagesResult,
  AskUniWorkspace,
} from '../../../shared/askuni-api'
import { AskUniComposer, type AskUniComposerInput } from './AskUniComposer'
import { AskUniHeader } from './AskUniHeader'
import { useAskUniConversations } from './AskUniHistory'
import { AskUniThread } from './AskUniThread'
import { frameBridge } from './frame-bridge'
import { useAskModelSelection } from './model-choice'
import { useAskUniStream } from './use-ask-uni-stream'

const SUGGESTIONS: readonly StringKey[] = [
  'askUniV2SuggestionOverdue',
  'askUniV2SuggestionMeetings',
  'askUniV2SuggestionChat',
]

function EmptyState({ onAsk }: { onAsk: (question: string) => void }): ReactElement {
  const { t } = useI18n()
  return (
    <div className="askuni2-empty">
      <span className="askuni2-empty-mark" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9z" />
          <path d="M18.5 3.5v3M17 5h3" />
        </svg>
      </span>
      <h2 className="askuni-empty-title">{t('askUniEmptyTitle')}</h2>
      <p className="askuni-empty-text">{t('askUniEmptyDescription')}</p>
      <p className="askuni-empty-text">{t('askUniDescription')}</p>
      <div
        className="askuni2-suggestions"
        data-slot="askuni-suggestions"
        role="group"
        aria-label={t('askUniV2Suggestions')}
      >
        {SUGGESTIONS.map((key) => (
          <button
            key={key}
            type="button"
            className="askuni2-suggestion"
            onClick={() => onAsk(t(key))}
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Ask UNI v2 for one workspace: header (title, history, new conversation), the thread (S3) and the
 * composer. The panel owns the conversation id: a new one, one opened from the history, or the id the
 * server names on the first answer. The caller resolves the signed-in context and the workspace.
 */
export function AskUniPanel({
  workspaceId,
  workspaces,
  onWorkspaceChange,
  visible = true,
  pendingFocus,
  onPendingFocusConsumed,
}: {
  workspaceId: string
  /** with more than one the header offers a switch */
  workspaces?: AskUniWorkspace[]
  onWorkspaceChange?: (id: string) => void
  visible?: boolean
  /** a focus an entry point wants on the next question (the document tab entry) */
  pendingFocus?: { kind: AskUniFocusKind; id: string; label?: string }
  onPendingFocusConsumed?: () => void
}): ReactElement {
  const { t, lang } = useI18n()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const conversations = useAskUniConversations(workspaceId, refreshKey)
  const selection = useAskModelSelection(workspaceId)

  const onConversation = useCallback((id: string) => {
    setConversationId(id)
    setRefreshKey((k) => k + 1)
  }, [])
  const onSettled = useCallback(() => setRefreshKey((k) => k + 1), [])
  const stream = useAskUniStream({ workspaceId, onConversation, onSettled })

  // another workspace has other conversations: start clean
  const streamRef = useRef(stream)
  streamRef.current = stream
  const lastWorkspace = useRef(workspaceId)
  useEffect(() => {
    if (lastWorkspace.current === workspaceId) return
    lastWorkspace.current = workspaceId
    streamRef.current.reset()
    setConversationId(null)
  }, [workspaceId])

  const loadMessages = useCallback(async (id: string): Promise<AskUniMessagesResult> => {
    const call = frameBridge().askUniMessages
    return call ? call({ conversationId: id }) : { ok: false, error: 'error' }
  }, [])

  const locale = lang === 'vi' ? 'vi' : 'en'
  const ask = (input: AskUniComposerInput, conversation: string | null) =>
    stream.ask({
      ...input,
      conversationId: conversation ?? undefined,
      ...(selection.model ? { model: selection.model } : {}),
      ...(selection.effort ? { effort: selection.effort } : {}),
    })

  const open = (id: string | null) => {
    stream.reset()
    setConversationId(id)
  }

  const streaming = stream.state.status === 'streaming'
  const showEmpty = conversationId === null && stream.state.status === 'idle'

  return (
    <section className="askuni2-panel" aria-label={t('askUniTitle')} hidden={!visible}>
      <AskUniHeader
        workspaceId={workspaceId}
        workspaces={workspaces}
        onWorkspaceChange={onWorkspaceChange}
        activeId={conversationId}
        conversations={conversations}
        onSelect={open}
        onNew={() => open(null)}
      />
      <div className="askuni2-body">
        {showEmpty ? (
          <EmptyState onAsk={(question) => ask({ question, locale }, null)} />
        ) : (
          <AskUniThread
            workspaceId={workspaceId}
            conversationId={conversationId}
            loadMessages={loadMessages}
            stream={stream}
            onRegenerate={(question) => ask({ question, locale }, conversationId)}
          />
        )}
      </div>
      <AskUniComposer
        workspaceId={workspaceId}
        conversationId={conversationId}
        streaming={streaming}
        selection={selection}
        pendingFocus={pendingFocus}
        onPendingFocusConsumed={onPendingFocusConsumed}
        onSend={(input) => ask(input, conversationId)}
        onStop={stream.stop}
      />
    </section>
  )
}
