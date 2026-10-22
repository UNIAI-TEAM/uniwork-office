import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ReactElement } from 'react'
import type { AskUniDocFlags } from '@genoffice/ai-provider/askuni'
import { AskUniAdapterProvider, useAskUniAdapter, type AskUniAdapter } from './adapter'
import { AskUniComposerBox } from './AskUniComposerBox'
import { AskUniThread } from './AskUniThread'
import { useAskUniStream, type AskUniStreamHandle } from './use-ask-uni-stream'
import './ask-uni.css'

/**
 * What the body keeps between visits: the conversation, the draft and the running turn. A panel
 * that unmounts the body (a collapsed dock swaps its whole tree for a rail) holds the session
 * itself, so none of it is lost; without one the body keeps its own.
 */
export interface AskUniSession {
  conversationId: string | null
  setConversationId: Dispatch<SetStateAction<string | null>>
  value: string
  setValue: Dispatch<SetStateAction<string>>
  stream: AskUniStreamHandle
}

export function useAskUniSession(adapter: AskUniAdapter): AskUniSession {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [value, setValue] = useState('')
  // an editor has no workspace to name: the hook adds none, and main derives it from the tab
  const stream = useAskUniStream(adapter, { onConversation: setConversationId })
  return { conversationId, setConversationId, value, setValue, stream }
}

export interface AskUniEditorBodyProps {
  adapter: AskUniAdapter
  /** the panel's own session; left out, the body keeps one for as long as it is mounted */
  session?: AskUniSession
  /** from useAskUniDocFlags; null = not known yet */
  flags: AskUniDocFlags | null
  /** the open file's name, as the editor already shows it; never an id */
  documentName: string
  /**
   * The panel's one polite live region setter (contract E1). With it the body renders no region
   * of its own; without it the thread keeps its single region.
   */
  onLiveStatus?: (text: string) => void
}

function Notice(props: { title: string; body?: string }): ReactElement {
  return (
    <section
      className="askuni-doc askuni-doc-state"
      aria-label={useAskUniAdapter().t('askUniDocRegion')}
    >
      <p className="askuni-doc-state-title">{props.title}</p>
      {props.body ? <p className="askuni-doc-state-body">{props.body}</p> : null}
    </section>
  )
}

function DocIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 2.5h4.8l2.7 2.7v8.3h-7.5z" />
      <path d="M9.3 2.5v2.7H12M6 8.5h4M6 11h4" />
    </svg>
  )
}

function Chat(props: {
  documentName: string
  session: AskUniSession
  onLiveStatus?: ((text: string) => void) | undefined
}): ReactElement {
  const { t } = useAskUniAdapter()
  const { conversationId, setConversationId, value, setValue, stream } = props.session
  const box = useRef<HTMLTextAreaElement>(null)

  const ask = (question: string) =>
    stream.ask({ question, ...(conversationId ? { conversationId } : {}) })
  const send = () => {
    const question = value.trim()
    if (!question) return
    ask(question)
    setValue('')
  }
  const newChat = () => {
    stream.reset()
    setConversationId(null)
    box.current?.focus()
  }
  const empty = conversationId === null && stream.state.status === 'idle'

  return (
    <section className="askuni-doc" aria-label={t('askUniDocRegion')}>
      <header className="askuni-doc-head">
        <span
          className="askuni-doc-chip"
          role="group"
          data-slot="askuni-doc-chip"
          title={props.documentName}
          aria-label={t('askUniDocChipAria', { name: props.documentName })}
        >
          <DocIcon />
          <span className="askuni-doc-chip-name">{props.documentName}</span>
        </span>
        <button
          type="button"
          className="askuni-doc-new"
          aria-label={t('askUniDocNewChat')}
          onClick={newChat}
        >
          {t('askUniDocNewChat')}
        </button>
      </header>
      {empty ? (
        <div className="askuni-doc-empty">
          <p className="askuni-doc-state-title">{t('askUniDocEmptyTitle')}</p>
          <p className="askuni-doc-state-body">{t('askUniDocEmptyBody')}</p>
        </div>
      ) : (
        <AskUniThread
          conversationId={conversationId}
          stream={stream}
          onRegenerate={ask}
          onStatus={props.onLiveStatus}
        />
      )}
      <AskUniComposerBox
        value={value}
        onValueChange={setValue}
        onSend={send}
        onStop={stream.stop}
        streaming={stream.state.status === 'streaming'}
        placeholder={t('askUniDocPlaceholder')}
        inputRef={box}
        slot="askuni-doc-composer"
      />
    </section>
  )
}

/**
 * Ask UNI inside an editor's AI panel: this document's chip, the thread, a plain composer and New
 * chat, or the one state its binding calls for. It never sees or sends a workspace, document or
 * focus id: the adapter's requests carry the question only, and main derives the rest from the tab.
 */
export function AskUniEditorBody(props: AskUniEditorBodyProps): ReactElement {
  const { flags } = props
  return (
    <AskUniAdapterProvider adapter={props.adapter}>
      <EditorState {...props} flags={flags} />
    </AskUniAdapterProvider>
  )
}

function EditorState(props: AskUniEditorBodyProps): ReactElement {
  const { t } = useAskUniAdapter()
  const { flags } = props
  if (!flags) return <Notice title={t('askUniDocLoading')} />
  if (flags.bound === 'signed_out') {
    return <Notice title={t('askUniDocSignedOutTitle')} body={t('askUniDocSignedOutBody')} />
  }
  if (flags.bound === 'hidden') {
    return <Notice title={t('askUniDocHiddenTitle')} body={t('askUniDocHiddenBody')} />
  }
  if (flags.bound === 'local') {
    return <Notice title={t('askUniDocLocalTitle')} body={t('askUniDocLocalBody')} />
  }
  if (!flags.streamEnabled) return <Notice title={t('askUniErrDisabled')} />
  if (props.session) {
    return (
      <Chat
        documentName={props.documentName}
        session={props.session}
        onLiveStatus={props.onLiveStatus}
      />
    )
  }
  return <OwnSessionChat documentName={props.documentName} onLiveStatus={props.onLiveStatus} />
}

function OwnSessionChat(props: {
  documentName: string
  onLiveStatus?: ((text: string) => void) | undefined
}): ReactElement {
  const session = useAskUniSession(useAskUniAdapter())
  return (
    <Chat documentName={props.documentName} session={session} onLiveStatus={props.onLiveStatus} />
  )
}
