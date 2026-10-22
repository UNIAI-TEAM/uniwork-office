import { vi } from 'vitest'
import type {
  AskUniFeedbackClearRequest,
  AskUniFeedbackRequest,
  AskUniMessage,
  AskUniMessagesResult,
  AskUniOkResult,
  AskUniStreamEvent,
  AskUniStreamStart,
} from '@genoffice/ai-provider/askuni'
import { askUniText } from '../src/strings-ask-uni'
import type { AskUniAdapter, AskUniAdapterRequest } from '../src/ask-uni'

// Shared fixtures of the ask-uni-*.test files: a fake adapter whose calls are spies, and the
// event/message builders every test reads the same way.

export const CITE = {
  sourceId: 'S1',
  kind: 'document' as const,
  title: 'Q3 plan.docx',
  quote: 'Budget is frozen',
  href: '/o/w/documents/1',
}

export function message(over: Partial<AskUniMessage> = {}): AskUniMessage {
  return {
    id: 'm-1',
    role: 'assistant',
    content: 'The budget is frozen [S1].',
    citations: [CITE],
    createdAt: '2026-10-22T03:00:00Z',
    ...over,
  }
}

export function msg(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  extra: Partial<AskUniMessage> = {},
): AskUniMessage {
  return { id, role, content, citations: [], createdAt: '2026-10-22T03:00:00Z', ...extra }
}

export const ev = {
  run: (requestId = 'r1', conversationId = 'conv-1'): AskUniStreamEvent => ({
    type: 'run',
    requestId,
    conversationId,
    runId: 'run-1',
  }),
  delta: (text: string, requestId = 'r1'): AskUniStreamEvent => ({
    type: 'delta',
    requestId,
    text,
  }),
  step: (counts: Record<string, number>, requestId = 'r1'): AskUniStreamEvent => ({
    type: 'step',
    requestId,
    round: 1,
    phase: 'tool',
    tool: 'search',
    counts,
  }),
  done: (over: Partial<AskUniMessage> = {}, requestId = 'r1'): AskUniStreamEvent => ({
    type: 'done',
    requestId,
    message: message(over),
  }),
}

export interface FakeAdapter {
  adapter: AskUniAdapter
  stream: ReturnType<typeof vi.fn<(req: AskUniAdapterRequest) => Promise<AskUniStreamStart>>>
  cancel: ReturnType<typeof vi.fn<(requestId: string) => Promise<unknown>>>
  loadMessages: ReturnType<
    typeof vi.fn<(id: string) => Promise<AskUniMessagesResult | AskUniMessage[]>>
  >
  feedbackSet: ReturnType<typeof vi.fn<(r: AskUniFeedbackRequest) => Promise<AskUniOkResult>>>
  feedbackClear: ReturnType<
    typeof vi.fn<(r: AskUniFeedbackClearRequest) => Promise<AskUniOkResult>>
  >
  openCitation: ReturnType<typeof vi.fn<(c: { kind: string; href: string }) => Promise<boolean>>>
  unsubscribe: ReturnType<typeof vi.fn<() => void>>
  /** how many times the hook subscribed to events */
  subscribed: () => number
  /** deliver one stream event to the subscriber */
  emit: (event: AskUniStreamEvent) => void
}

/** a fake adapter that answers every start with r1, r2, ... and renders strings from the real shard */
export function fakeAdapter(lang: 'en' | 'vi' | 'zh' = 'en'): FakeAdapter {
  let listener: ((e: AskUniStreamEvent) => void) | null = null
  let subscribeCalls = 0
  let counter = 0
  const unsubscribe = vi.fn<() => void>()
  const stream = vi.fn<(req: AskUniAdapterRequest) => Promise<AskUniStreamStart>>(async () => ({
    ok: true as const,
    requestId: `r${++counter}`,
  }))
  const cancel = vi.fn<(requestId: string) => Promise<unknown>>(async () => ({ ok: true }))
  const loadMessages = vi.fn<(id: string) => Promise<AskUniMessagesResult | AskUniMessage[]>>(
    async () => ({ ok: true as const, messages: [] }),
  )
  const feedbackSet = vi.fn<(r: AskUniFeedbackRequest) => Promise<AskUniOkResult>>(async () => ({
    ok: true as const,
  }))
  const feedbackClear = vi.fn<(r: AskUniFeedbackClearRequest) => Promise<AskUniOkResult>>(
    async () => ({ ok: true as const }),
  )
  const openCitation = vi.fn<(c: { kind: string; href: string }) => Promise<boolean>>(
    async () => true,
  )
  const adapter: AskUniAdapter = {
    stream: (req) => stream(req),
    cancel: (id) => cancel(id),
    onEvent: (cb) => {
      subscribeCalls += 1
      listener = cb
      return unsubscribe
    },
    loadMessages: (id) => loadMessages(id),
    feedbackSet: (r) => feedbackSet(r),
    feedbackClear: (r) => feedbackClear(r),
    openCitation: (c) => openCitation(c),
    t: (key, params) => askUniText(lang, key, params),
    lang,
  }
  return {
    adapter,
    stream,
    cancel,
    loadMessages,
    feedbackSet,
    feedbackClear,
    openCitation,
    unsubscribe,
    subscribed: () => subscribeCalls,
    emit: (event) => listener?.(event),
  }
}
