import { createContext, createElement, useContext } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Lang, Params } from '@genoffice/i18n'
import type {
  AskUniCitationKind,
  AskUniDocBridge,
  AskUniDocStreamRequest,
  AskUniFeedbackClearRequest,
  AskUniFeedbackRequest,
  AskUniMessage,
  AskUniMessagesResult,
  AskUniOkResult,
  AskUniStreamEvent,
  AskUniStreamRequest,
  AskUniStreamStart,
} from '@genoffice/ai-provider/askuni'
import type { AskUniStringKey } from '../strings-ask-uni'

/**
 * What a turn is asked with. Home sends the workspace, focus, mentions and model; an editor sends
 * only the question (main derives the workspace and document from the asking tab), so every field
 * but the question is optional here and the host's adapter decides what crosses.
 */
export type AskUniAdapterRequest = Omit<AskUniStreamRequest, 'workspaceId'> & {
  workspaceId?: string
}

/** feedback calls the actions bar uses; a host may also hand its own to one bar */
export interface AskUniFeedbackApi {
  set(req: AskUniFeedbackRequest): Promise<AskUniOkResult>
  clear(req: AskUniFeedbackClearRequest): Promise<AskUniOkResult>
}

/**
 * Everything the shared Ask UNI core needs from its host, in place of shell globals: Home builds it
 * from `window.aiOffice`, an editor from `window.uniworkAskUniDoc` (createAskUniDocAdapter).
 */
export interface AskUniAdapter {
  /** starts one streamed turn; events then arrive through onEvent */
  stream(req: AskUniAdapterRequest): Promise<AskUniStreamStart>
  /** stops one of this host's own requests */
  cancel(requestId: string): Promise<unknown> | undefined | void
  /** one subscription for the hook's life; returns the unsubscribe */
  onEvent(cb: (ev: AskUniStreamEvent) => void): (() => void) | undefined | void
  /** the stored messages of a conversation */
  loadMessages(conversationId: string): Promise<AskUniMessagesResult | AskUniMessage[]>
  feedbackSet(req: AskUniFeedbackRequest): Promise<AskUniOkResult>
  feedbackClear(req: AskUniFeedbackClearRequest): Promise<AskUniOkResult>
  /**
   * Opens a cited source; false = it did not open. A host that cannot open sources (an editor)
   * leaves it out, and the answer shows its sources as plain chips with no Open action.
   */
  openCitation?(c: { kind: AskUniCitationKind; href: string }): Promise<boolean>
  t(key: AskUniStringKey, params?: Params): string
  lang: Lang
}

const Ctx = createContext<AskUniAdapter | null>(null)

export function AskUniAdapterProvider(props: {
  adapter: AskUniAdapter
  children?: ReactNode
}): ReactElement {
  return createElement(Ctx.Provider, { value: props.adapter }, props.children)
}

export function useAskUniAdapter(): AskUniAdapter {
  const adapter = useContext(Ctx)
  if (!adapter) throw new Error('Ask UNI components need an <AskUniAdapterProvider>')
  return adapter
}

/**
 * The adapter of an editor renderer over window.uniworkAskUniDoc. The editor bridge carries no
 * workspace or document id (main derives both from the tab), and has no citation opener.
 */
export function createAskUniDocAdapter(
  bridge: AskUniDocBridge,
  t: AskUniAdapter['t'],
  lang: Lang,
): AskUniAdapter {
  return {
    stream: (req) => {
      // the editor request is the question and its options only: whatever a host added is dropped
      const doc: AskUniDocStreamRequest = {
        question: req.question,
        ...(req.locale !== undefined ? { locale: req.locale } : {}),
        ...(req.model !== undefined ? { model: req.model } : {}),
        ...(req.effort !== undefined ? { effort: req.effort } : {}),
        ...(req.conversationId !== undefined ? { conversationId: req.conversationId } : {}),
      }
      return bridge.askUniDocStream(doc)
    },
    cancel: (requestId) => bridge.askUniDocStreamCancel({ requestId }),
    onEvent: (cb) => bridge.onAskUniDocStreamEvent(cb),
    loadMessages: (conversationId) => bridge.askUniDocMessages({ conversationId }),
    feedbackSet: (req) => bridge.askUniDocFeedbackSet(req),
    feedbackClear: (req) => bridge.askUniDocFeedbackClear(req),
    t,
    lang,
  }
}
