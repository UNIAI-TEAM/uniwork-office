import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { AskUniCitation, AskUniMessage } from '@genoffice/ai-provider/askuni'
import { Markdown, type MarkdownInlineToken } from '../Markdown'
import '../markdown.css'
import type { AskUniStringKey } from '../strings-ask-uni'
import { useAskUniAdapter, type AskUniFeedbackApi } from './adapter'
import { AskUniActions } from './AskUniActions'
import { CitationMarker, SourceChips } from './AskUniCitation'
import { AskUniSteps } from './AskUniSteps'
import './ask-uni.css'

const CITE_TOKEN = /\[S(\d+)\]/gi

/** a question or an answer; `notice` is optional so a live turn can carry what it knows so far */
export type AskUniTurnMessage = Pick<AskUniMessage, 'id' | 'role' | 'content' | 'citations'> &
  Partial<Pick<AskUniMessage, 'notice'>>

const NOTICE_KEYS: Record<string, AskUniStringKey> = {
  no_sources: 'askUniNoticeNoSources',
  empty_answer: 'askUniV2NoticeEmptyAnswer',
  stopped: 'askUniV2NoticeStopped',
}

/**
 * The model-written answer as markdown: raw HTML inert, links never clickable, and `[Sn]` markers
 * that match a citation as small buttons with a quote card (one card open at a time). A marker that
 * matches no citation stays plain text.
 */
function AnswerBody({
  content,
  citations,
  onOpen,
}: {
  content: string
  citations: AskUniCitation[]
  /** undefined = the host cannot open sources: the card has no Open action */
  onOpen: ((c: AskUniCitation) => void) | undefined
}): ReactElement {
  const [openId, setOpenId] = useState<number | null>(null)
  const byN = useMemo(() => {
    const map = new Map<string, AskUniCitation>()
    for (const c of citations) map.set(c.sourceId.toUpperCase(), c)
    return map
  }, [citations])
  // markers render in text order, so their running number is stable for one content
  let seq = 0
  const token: MarkdownInlineToken = {
    pattern: CITE_TOKEN,
    render: (m, key) => {
      const c = byN.get(`S${m[1]}`)
      if (!c) return m[0]
      const n = m[1] ?? ''
      const id = seq++
      return (
        <CitationMarker
          key={key}
          citation={c}
          n={n}
          open={openId === id}
          onOpenChange={(next) => setOpenId((cur) => (next ? id : cur === id ? null : cur))}
          onOpen={onOpen}
        />
      )
    },
  }
  return (
    <div className="askuni-v2-body">
      <Markdown text={content} inlineToken={token} />
    </div>
  )
}

/**
 * One question or answer. The action bar shows only for a finished, stored answer
 * (`conversationId` known, not a live or pending echo); `onRegenerate` is passed for the last answer.
 */
export function AskUniTurn({
  message,
  streaming = false,
  conversationId,
  counts,
  onRegenerate,
  regenerateDisabled,
  feedback,
  onOpenCitation,
}: {
  message: AskUniTurnMessage
  streaming?: boolean
  conversationId?: string | null
  /** summed step counts, for the live turn and the one just finished */
  counts?: Record<string, number>
  onRegenerate?: () => void
  regenerateDisabled?: boolean
  feedback?: AskUniFeedbackApi
  /** open a cited source; false = it did not open. Defaults to the adapter's opener, if it has one */
  onOpenCitation?: (c: AskUniCitation) => Promise<boolean>
}): ReactElement {
  const adapter = useAskUniAdapter()
  const { t } = adapter
  const [openFailed, setOpenFailed] = useState(false)
  const opener =
    onOpenCitation ??
    (adapter.openCitation
      ? (c: AskUniCitation) => adapter.openCitation!({ kind: c.kind, href: c.href })
      : undefined)

  if (message.role === 'user') {
    return (
      <li className="askuni-v2-turn is-user">
        <span className="askuni-v2-sr">{t('askUniYou')}: </span>
        <p className="askuni-v2-question">{message.content}</p>
      </li>
    )
  }

  const open = opener
    ? (c: AskUniCitation) => {
        setOpenFailed(false)
        opener(c).then(
          (ok) => setOpenFailed(!ok),
          () => setOpenFailed(true),
        )
      }
    : undefined
  const hasText = message.content.trim() !== ''
  const notice = message.notice
  // a partial answer that was stopped keeps its text and gets the note; any other notice stands in
  // for an empty answer, and a finished answer with neither text nor notice says UNI could not answer
  let noticeKey: AskUniStringKey | null = null
  if (notice && (!hasText || notice === 'stopped')) {
    noticeKey = NOTICE_KEYS[notice] ?? 'askUniNoticeUnavailable'
  } else if (!notice && !hasText && !streaming) {
    noticeKey = 'askUniNoticeUnavailable'
  }
  const stored =
    !streaming && !!conversationId && !message.id.startsWith('pending-') && message.id !== 'live'
  return (
    <li className="askuni-v2-turn is-assistant">
      <span className="askuni-v2-role">{t('askUniUni')}</span>
      <div className="askuni-v2-answer">
        {counts ? <AskUniSteps counts={counts} /> : null}
        {hasText ? (
          <AnswerBody content={message.content} citations={message.citations} onOpen={open} />
        ) : null}
        {noticeKey ? <p className="askuni-v2-notice">{t(noticeKey)}</p> : null}
        {streaming && !hasText ? (
          <p className="askuni-v2-working">
            <span className="askuni-v2-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {t('askUniThinking')}
          </p>
        ) : null}
        <SourceChips citations={message.citations} onOpen={open} />
        {openFailed ? <p className="askuni-v2-note">{t('askUniOpenFailed')}</p> : null}
        {stored && conversationId ? (
          <AskUniActions
            conversationId={conversationId}
            messageId={message.id}
            content={message.content}
            citations={message.citations}
            onRegenerate={onRegenerate}
            regenerateDisabled={regenerateDisabled}
            feedback={feedback}
          />
        ) : null}
      </div>
    </li>
  )
}
