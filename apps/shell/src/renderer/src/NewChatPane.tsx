import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useI18n } from './locale'
import { AskUniHost } from './AskUniHost'
import { consumeAskUniOpen, useAskUniOpenRequest } from './askuni-entry'

/**
 * Home's chat pane: Ask UNI, the one AI chat on this screen. A request from elsewhere (Ctrl/Cmd+J)
 * puts the caret in its composer; the host shows its own signed-out and no-workspace states.
 */
export function NewChatPane(): ReactElement {
  const { t } = useI18n()
  const [askFocusToken, setAskFocusToken] = useState(0)
  const askOpenRequest = useAskUniOpenRequest()
  const askRequestSeq = askOpenRequest?.seq ?? null
  useEffect(() => {
    if (askRequestSeq === null) return
    setAskFocusToken((n) => n + 1)
    consumeAskUniOpen(askRequestSeq)
  }, [askRequestSeq])

  return (
    <main className="new-chat is-ask" aria-label={t('askUniTitle')}>
      <header className="new-chat-bar">
        <h1 className="new-chat-title">{t('askUniTitle')}</h1>
      </header>
      <AskUniHost visible focusToken={askFocusToken} />
    </main>
  )
}
