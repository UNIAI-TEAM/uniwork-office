import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { AskUniDocBridge, AskUniDocFlags } from '@genoffice/ai-provider/askuni'
import { askUniText } from '../strings-ask-uni'
import { createAskUniDocAdapter, type AskUniAdapter } from './adapter'
import { AskUniEditorBody, useAskUniSession, type AskUniSession } from './AskUniEditorBody'
import { useAskUniDocFlags } from './use-ask-uni-doc-flags'
import './ask-uni-panel-mode.css'

// Ask UNI as a mode of an editor AI panel (contract E1; one component for every editor): a toggle in
// the panel header, a body that takes the place of the chat while it is on, and the panel's one polite live region. The chat stays mounted but
// hidden, so its draft, scroll and any running turn survive. The Ask UNI side survives too, also when
// the dock collapses and the panel renders a rail in place of everything: its conversation, draft and
// running turn live in the mode (the panel instance outlives the collapse), not in the body. Everything is behind the editor bridge
// (`window.uniworkAskUniDoc`, installed by the preload): without it, as in the web build, the toggle
// is not there. The renderer never names a workspace or a document: main derives both from the tab.

export interface AskUniMode {
  /** the editor bridge is there and the stream is on: the panel shows the toggle */
  offered: boolean
  /** Ask UNI is showing in place of the chat */
  active: boolean
  toggle: () => void
  /**
   * back to the chat (an AI action runs there); the Ask UNI conversation stays. `then` runs once the
   * chat pane is shown (at once when it already is): focus calls belong there, the pane is hidden
   * until the state change has rendered.
   */
  leave: (then?: () => void) => void
  flags: AskUniDocFlags | null
  adapter: AskUniAdapter | null
  /** the Ask UNI body's status for the panel's one live region */
  status: string
  setStatus: (text: string) => void
  /** the body has been opened once: it stays mounted (hidden) so its thread view survives a toggle */
  opened: boolean
  /** the conversation, draft and running turn: owned here so a collapsed dock does not drop them */
  session: AskUniSession
}

/** what the session talks to while there is no editor bridge (nothing is offered then) */
const NO_HOST: AskUniAdapter = {
  stream: async () => ({ ok: false, error: 'error' }),
  cancel: () => undefined,
  onEvent: () => undefined,
  loadMessages: async () => [],
  feedbackSet: async () => ({ ok: false, error: 'error' }),
  feedbackClear: async () => ({ ok: false, error: 'error' }),
  t: (key) => String(key),
  lang: 'en',
}

function askUniDocBridge(): AskUniDocBridge | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as unknown as { uniworkAskUniDoc?: AskUniDocBridge }).uniworkAskUniDoc
}

/** the last path segment of an open file: the chip shows this and nothing else */
export function askUniFileName(path: string | null | undefined): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

/**
 * Panel mode state. `bindingKey` is whatever names the file the tab shows (its path): what the tab is
 * bound to (a UniWork document, a local file, ...) is read from main again when the key changes and each
 * time the mode is turned on, so a file saved to UniWork in between is picked up.
 */
export function useAskUniMode(lang: Lang, bindingKey?: string | null): AskUniMode {
  const bridge = askUniDocBridge()
  const [on, setOn] = useState(false)
  const [opened, setOpened] = useState(false)
  const [tick, setTick] = useState(0)
  const [status, setStatus] = useState('')
  // another file in the tab, or the mode turned on again, reads the binding from main again
  const flags = useAskUniDocFlags(bridge, `${tick}:${bindingKey ?? ''}`)
  const adapter = useMemo(
    () =>
      bridge
        ? createAskUniDocAdapter(bridge, (key, params) => askUniText(lang, key, params), lang)
        : null,
    [bridge, lang],
  )
  const session = useAskUniSession(adapter ?? NO_HOST)
  // a tab that is not a chat (local file, signed out, hidden, stream off) must not keep a conversation
  // or a running turn for the next binding: the next document or account starts empty
  const chatUnavailable =
    flags !== null && (flags.bound !== 'document' || flags.streamEnabled !== true)
  const { reset: resetStream } = session.stream
  const { setConversationId, setValue } = session
  useEffect(() => {
    if (!chatUnavailable) return
    resetStream()
    setConversationId(null)
    setValue('')
  }, [chatUnavailable, resetStream, setConversationId, setValue])
  const offered = adapter !== null && flags?.streamEnabled === true
  const active = on && offered
  const toggle = useCallback(() => {
    if (!on) {
      setTick((n) => n + 1)
      setOpened(true)
    }
    setOn(!on)
  }, [on])
  const onRef = useRef(on)
  onRef.current = on
  const afterLeave = useRef<Array<() => void>>([])
  const leave = useCallback((then?: () => void) => {
    if (!onRef.current) {
      then?.()
      return
    }
    if (then) afterLeave.current.push(then)
    setOn(false)
  }, [])
  // the chat pane is shown again once this commit is out: what was waiting for it runs now
  useEffect(() => {
    if (on) return
    const pending = afterLeave.current
    afterLeave.current = []
    for (const run of pending) run()
  }, [on])
  return {
    offered,
    active,
    toggle,
    leave,
    flags,
    adapter,
    status,
    setStatus,
    opened: opened && offered,
    session,
  }
}

function AskUniIcon(): ReactElement {
  return (
    <svg
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
      <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11h-.5A.5.5 0 0 1 3 10.5z" />
      <path d="M8 5.2v3.2M6.4 6.8h3.2" />
    </svg>
  )
}

/** the header button: not rendered unless Ask UNI is offered for this panel */
export function AskUniModeToggle(props: { mode: AskUniMode; lang: Lang }): ReactElement | null {
  const { mode, lang } = props
  if (!mode.offered) return null
  const label = askUniText(lang, 'askUniDocRegion')
  return (
    <button
      type="button"
      className="ai-header-btn ai-askuni-toggle"
      data-ask-uni-toggle=""
      data-tip={label}
      aria-label={label}
      aria-pressed={mode.active}
      onClick={mode.toggle}
    >
      <AskUniIcon />
    </button>
  )
}

/** the Ask UNI body; kept mounted (hidden) after the first open so its view survives a toggle */
export function AskUniModeBody(props: {
  mode: AskUniMode
  documentName: string
}): ReactElement | null {
  const { mode } = props
  if (!mode.opened || !mode.adapter) return null
  return (
    <div className="ai-askuni-pane" hidden={!mode.active}>
      <AskUniEditorBody
        adapter={mode.adapter}
        flags={mode.flags}
        documentName={props.documentName}
        session={mode.session}
        onLiveStatus={mode.setStatus}
      />
    </div>
  )
}

/** spread on the wrapper around the chat and the composers: hidden, never unmounted, while Ask UNI shows */
export function askUniChatPaneProps(mode: AskUniMode): { className: string; hidden: boolean } {
  return { className: 'ai-askuni-chat-pane', hidden: mode.active }
}

/** the one live region's text: the Ask UNI status while it shows, otherwise the chat's own */
export function askUniLiveText(mode: AskUniMode, chatText: string): string {
  return mode.active ? mode.status : chatText
}
