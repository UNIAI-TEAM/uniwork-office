// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { AskUniThread } from '../src/renderer/src/askuni-v2/AskUniThread'
import { clearAskUniRatings } from '../src/renderer/src/askuni-v2/AskUniActions'
import type {
  AskStreamState,
  AskUniStreamHandle,
} from '../src/renderer/src/askuni-v2/use-ask-uni-stream'
import { en } from '../src/renderer/src/i18n/askuni/en'
import type { AskUniCitation, AskUniMessage, AskUniMessagesResult } from '../src/shared/askuni-api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CITE: AskUniCitation = {
  sourceId: 'S1',
  kind: 'document',
  title: 'Q3 plan.docx',
  quote: 'Budget is frozen',
  href: '/o/w/documents/1',
}

function msg(id: string, role: 'user' | 'assistant', content: string, extra = {}): AskUniMessage {
  return { id, role, content, citations: [], createdAt: '2026-10-22T03:00:00Z', ...extra }
}

const IDLE: AskStreamState = {
  status: 'idle',
  question: '',
  conversationId: null,
  draft: '',
  counts: {},
  citations: [],
  message: null,
  errorCode: null,
  retryAfterSeconds: null,
  reloadTick: 0,
}

describe('AskUniThread', () => {
  let host: HTMLDivElement
  let root: Root
  let stored: AskUniMessage[]
  let loadMessages: ReturnType<
    typeof vi.fn<(id: string) => Promise<AskUniMessagesResult | AskUniMessage[]>>
  >
  let stream: AskUniStreamHandle
  let onRegenerate: ReturnType<typeof vi.fn<(q: string) => void>>
  let onFeedback: { set: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> }

  function streamWith(over: Partial<AskStreamState> = {}): AskUniStreamHandle {
    return {
      state: { ...IDLE, ...over },
      ask: vi.fn(),
      stop: vi.fn(),
      retry: vi.fn(),
      reset: vi.fn(),
    }
  }

  async function mount(
    over: {
      conversationId?: string | null
      state?: Partial<AskStreamState>
      lang?: 'en' | 'vi'
    } = {},
  ): Promise<void> {
    stream = streamWith(over.state)
    await act(async () => {
      root.render(
        h(LocaleProvider, {
          initial: over.lang ?? 'en',
          children: h(AskUniThread, {
            workspaceId: 'ws-1',
            conversationId: over.conversationId === undefined ? 'conv-1' : over.conversationId,
            loadMessages,
            stream,
            onRegenerate,
            onFeedback,
          }),
        }),
      )
    })
    await flush()
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
  }

  const scroller = () => host.querySelector('.askuni-v2-thread') as HTMLElement
  const turns = () => [...host.querySelectorAll('.askuni-v2-turns > li')]
  const copyBtns = () => host.querySelectorAll('button[aria-label="Copy"]')

  beforeEach(() => {
    clearAskUniRatings()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    stored = [
      msg('u1', 'user', 'What is blocked?'),
      msg('a1', 'assistant', 'Billing is blocked [S1].', { citations: [CITE] }),
      msg('u2', 'user', 'And next week?'),
      msg('a2', 'assistant', 'Nothing yet.'),
    ]
    loadMessages = vi.fn(async () => ({ ok: true as const, messages: stored }))
    onRegenerate = vi.fn()
    onFeedback = {
      set: vi.fn(async () => ({ ok: true })),
      clear: vi.fn(async () => ({ ok: true })),
    }
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  describe('stored messages', () => {
    it('loads the conversation and shows its questions and answers in order', async () => {
      await mount()
      expect(loadMessages).toHaveBeenCalledExactlyOnceWith('conv-1')
      expect(turns().map((t) => t.textContent)).toEqual([
        expect.stringContaining('What is blocked?'),
        expect.stringContaining('Billing is blocked'),
        expect.stringContaining('And next week?'),
        expect.stringContaining('Nothing yet.'),
      ])
    })

    it('accepts a plain message array from the loader', async () => {
      loadMessages.mockResolvedValue(stored)
      await mount()
      expect(turns()).toHaveLength(4)
    })

    it('has no stored turns and no load for a new conversation', async () => {
      await mount({ conversationId: null })
      expect(loadMessages).not.toHaveBeenCalled()
      expect(turns()).toHaveLength(0)
    })

    it('reloads when the conversation changes, replacing the old turns', async () => {
      await mount()
      loadMessages.mockResolvedValue({ ok: true, messages: [msg('x1', 'user', 'Other chat')] })
      await mount({ conversationId: 'conv-2' })
      expect(loadMessages).toHaveBeenLastCalledWith('conv-2')
      expect(turns()).toHaveLength(1)
      expect(host.textContent).toContain('Other chat')
      expect(host.textContent).not.toContain('Billing')
    })

    it('reloads when the stream asks for it (stop, done) and keeps the turns when the reload fails', async () => {
      await mount()
      loadMessages.mockResolvedValueOnce({ ok: false, error: 'offline' })
      await mount({ state: { reloadTick: 1 } })
      expect(loadMessages).toHaveBeenCalledTimes(2)
      expect(turns()).toHaveLength(4)
      loadMessages.mockRejectedValueOnce(new Error('x'))
      await mount({ state: { reloadTick: 2 } })
      expect(turns()).toHaveLength(4)
    })

    it('drops the answer of a load that finished after the conversation changed', async () => {
      let resolveOld: (r: AskUniMessagesResult) => void = () => undefined
      loadMessages.mockImplementationOnce(
        () =>
          new Promise<AskUniMessagesResult>((res) => {
            resolveOld = res
          }),
      )
      await mount()
      loadMessages.mockResolvedValue({ ok: true, messages: [msg('n1', 'user', 'New chat')] })
      await mount({ conversationId: 'conv-2' })
      await act(async () => {
        resolveOld({ ok: true, messages: stored })
      })
      expect(host.textContent).toContain('New chat')
      expect(host.textContent).not.toContain('Billing')
    })

    it('shows the actions under every stored answer, regenerate only under the last', async () => {
      await mount()
      expect(copyBtns()).toHaveLength(2)
      expect(host.querySelectorAll('button[aria-label="Regenerate"]')).toHaveLength(1)
      expect(turns()[3]?.querySelector('button[aria-label="Regenerate"]')).not.toBeNull()
    })
  })

  describe('regenerate', () => {
    it('hands the last question to the panel, which resends it', async () => {
      await mount()
      await act(async () => {
        ;(host.querySelector('button[aria-label="Regenerate"]') as HTMLButtonElement).click()
      })
      expect(onRegenerate).toHaveBeenCalledExactlyOnceWith('And next week?')
    })

    it('is disabled while a turn is running', async () => {
      await mount({ state: { status: 'streaming', question: 'q', conversationId: 'conv-1' } })
      expect(
        host.querySelector('button[aria-label="Regenerate"]')?.getAttribute('aria-disabled'),
      ).toBe('true')
    })

    it('is not offered when no question is stored', async () => {
      loadMessages.mockResolvedValue({ ok: true, messages: [msg('a1', 'assistant', 'Hi')] })
      await mount()
      expect(host.querySelector('button[aria-label="Regenerate"]')).toBeNull()
    })
  })

  describe('feedback', () => {
    it('sends ratings through onFeedback', async () => {
      await mount()
      await act(async () => {
        ;(host.querySelectorAll('button[aria-label="Helpful"]')[1] as HTMLButtonElement).click()
        await Promise.resolve()
      })
      expect(onFeedback.set).toHaveBeenCalledExactlyOnceWith({
        conversationId: 'conv-1',
        messageId: 'a2',
        rating: 'up',
      })
    })
  })

  describe('the live turn', () => {
    const live = (over: Partial<AskStreamState>): Partial<AskStreamState> => ({
      status: 'streaming',
      question: 'Who owns billing?',
      conversationId: 'conv-1',
      ...over,
    })

    it('shows the question and a working state before the first text', async () => {
      await mount({ state: live({}) })
      expect(turns()).toHaveLength(6)
      expect(turns()[4]?.textContent).toContain('Who owns billing?')
      expect(host.querySelector('.askuni-v2-working')?.textContent).toContain(en.askUniThinking)
    })

    it('shows the draft with the citations that already arrived, and the step summary', async () => {
      await mount({
        state: live({
          draft: 'Lan owns it [S1]',
          citations: [CITE],
          counts: { task: 3 },
        }),
      })
      const last = turns()[5]!
      expect(last.textContent).toContain('Lan owns it')
      expect(last.textContent).toContain('Looked at 3 tasks')
      expect(last.querySelector('[aria-label="Source 1: Q3 plan.docx"]')).not.toBeNull()
      expect(host.querySelector('.askuni-v2-working')).toBeNull()
    })

    it('shows a new conversation turn while the conversation is not named yet', async () => {
      await mount({
        conversationId: null,
        state: live({ conversationId: null, draft: 'First words' }),
      })
      expect(turns()).toHaveLength(2)
      expect(host.textContent).toContain('First words')
    })

    it('hides a turn that belongs to another conversation', async () => {
      await mount({ state: live({ conversationId: 'conv-other', draft: 'Not here' }) })
      expect(host.textContent).not.toContain('Not here')
      expect(turns()).toHaveLength(4)
    })

    it('shows the finished message with its actions until the reload has it', async () => {
      const done = msg('a3', 'assistant', 'Lan owns it.')
      await mount({ state: live({ status: 'done', message: done }) })
      expect(turns()).toHaveLength(6)
      expect(turns()[5]?.querySelector('button[aria-label="Copy"]')).not.toBeNull()
    })

    it('shows the finished turn once, not twice, when the reload already holds it', async () => {
      const done = msg('a2', 'assistant', 'Nothing yet.')
      await mount({ state: live({ status: 'done', message: done, question: 'And next week?' }) })
      expect(turns()).toHaveLength(4)
    })

    it('a stopped turn before any text shows the note with neither copy nor rating', async () => {
      await mount({
        conversationId: null,
        state: live({ status: 'stopped', conversationId: null }),
      })
      expect(host.textContent).toContain(en.askUniV2NoticeStopped)
      expect(copyBtns()).toHaveLength(0)
      expect(host.querySelector('button[aria-label="Helpful"]')).toBeNull()
    })

    it('a stopped turn keeps its partial text until the reload holds it', async () => {
      await mount({ state: live({ status: 'stopped', draft: 'Half an ans' }) })
      expect(turns()[5]?.textContent).toContain('Half an ans')
      expect(turns()[5]?.textContent).toContain(en.askUniV2NoticeStopped)
    })

    it('a stopped turn disappears once the reload brought its question and partial answer', async () => {
      await mount({ state: live({ draft: 'Half an ans' }) })
      await mount({ state: live({ status: 'stopped', draft: 'Half an ans' }) })
      expect(turns()).toHaveLength(6)
      loadMessages.mockResolvedValue({
        ok: true,
        messages: [
          ...stored,
          msg('u3', 'user', 'Who owns billing?'),
          msg('a3', 'assistant', 'Half an ans', { notice: 'stopped' }),
        ],
      })
      await mount({ state: live({ status: 'stopped', draft: 'Half an ans', reloadTick: 1 }) })
      expect(turns()).toHaveLength(6)
      expect(host.textContent?.match(/Half an ans/g)).toHaveLength(1)
    })
  })

  describe('errors', () => {
    const failed = (code: AskStreamState['errorCode'], extra: Partial<AskStreamState> = {}) => ({
      status: 'error' as const,
      question: 'Who owns billing?',
      conversationId: 'conv-1',
      errorCode: code,
      ...extra,
    })

    it.each([
      ['offline', en.askUniErrOffline],
      ['quota', en.askUniErrQuota],
      ['forbidden', en.askUniErrForbidden],
      ['disabled', en.askUniErrDisabled],
      ['session', en.askUniErrSession],
      ['signed_out', en.askUniSignedOut],
      ['error', en.askUniErrDefault],
      ['provider_error', en.askUniV2ErrProviderError],
      ['provider_timeout', en.askUniV2ErrProviderTimeout],
      ['output_invalid', en.askUniV2ErrOutputInvalid],
      ['tool_not_allowed', en.askUniV2ErrToolNotAllowed],
      ['refused', en.askUniV2ErrRefused],
      ['cancelled', en.askUniV2ErrCancelled],
      ['stream_ended', en.askUniV2ErrStreamEnded],
    ] as const)('shows the wording for %s under the question', async (code, text) => {
      await mount({ state: failed(code) })
      expect(turns()[4]?.textContent).toContain('Who owns billing?')
      expect(host.textContent).toContain(text)
    })

    it('says how long to wait on a rate limit, and without a wait the plain wording', async () => {
      await mount({ state: failed('rate_limited', { retryAfterSeconds: 12.2 }) })
      expect(host.textContent).toContain('try again in 13 seconds')
      await mount({ state: failed('rate_limited') })
      expect(host.textContent).toContain(en.askUniErrRateLimited)
    })

    it('shows an unknown code as the default wording', async () => {
      await mount({ state: failed('weird_new_code' as never) })
      expect(host.textContent).toContain(en.askUniErrDefault)
    })

    it('retry keeps the question and asks it again', async () => {
      await mount({ state: failed('provider_error') })
      const retry = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === en.askUniV2Retry,
      )
      expect(retry).toBeDefined()
      await act(async () => retry!.click())
      expect(stream.retry).toHaveBeenCalledTimes(1)
    })

    it.each(['signed_out', 'session', 'disabled', 'forbidden', 'quota'] as const)(
      'offers no retry for %s (it would fail the same way)',
      async (code) => {
        await mount({ state: failed(code) })
        expect(
          [...host.querySelectorAll('button')].some((b) => b.textContent === en.askUniV2Retry),
        ).toBe(false)
      },
    )

    it('keeps the partial text the stream had written before it failed', async () => {
      await mount({ state: failed('stream_ended', { draft: 'Half an answer' }) })
      expect(host.textContent).toContain('Half an answer')
    })
  })

  describe('accessibility', () => {
    it('has one polite live region that announces the turn status, not every delta', async () => {
      await mount({
        state: { status: 'streaming', question: 'q', conversationId: 'conv-1', draft: 'x' },
      })
      const regions = host.querySelectorAll('[aria-live]')
      expect(regions).toHaveLength(1)
      expect(regions[0]?.getAttribute('aria-live')).toBe('polite')
      expect(regions[0]?.textContent).toBe(en.askUniThinking)
      expect(host.querySelectorAll('[role="alert"],[role="status"]')).toHaveLength(0)
      await mount({
        state: {
          status: 'done',
          question: 'q',
          conversationId: 'conv-1',
          message: msg('a9', 'assistant', 'Done'),
        },
      })
      expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
      expect(host.querySelector('[aria-live]')?.textContent).toBe(en.askUniV2AnswerReady)
    })

    it('announces an error and a stop', async () => {
      await mount({
        state: { status: 'error', question: 'q', conversationId: 'conv-1', errorCode: 'offline' },
      })
      expect(host.querySelector('[aria-live]')?.textContent).toBe(en.askUniErrOffline)
      await mount({ state: { status: 'stopped', question: 'q', conversationId: 'conv-1' } })
      expect(host.querySelector('[aria-live]')?.textContent).toBe(en.askUniV2NoticeStopped)
    })

    it('marks the list busy while streaming', async () => {
      await mount({ state: { status: 'streaming', question: 'q', conversationId: 'conv-1' } })
      expect(host.querySelector('.askuni-v2-turns')?.getAttribute('aria-busy')).toBe('true')
    })

    it('labels who spoke for screen readers', async () => {
      await mount()
      expect(turns()[0]?.textContent).toContain(`${en.askUniYou}: `)
      expect(turns()[1]?.textContent).toContain(en.askUniUni)
    })
  })

  describe('scrolling', () => {
    function layout(scrollTop: number): void {
      const el = scroller()
      Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true })
      el.scrollTop = scrollTop
    }
    const streaming = (draft: string): Partial<AskStreamState> => ({
      status: 'streaming',
      question: 'q',
      conversationId: 'conv-1',
      draft,
    })

    it('follows the answer while the reader is at the bottom', async () => {
      await mount({ state: streaming('a') })
      layout(600)
      await act(async () => {
        scroller().dispatchEvent(new Event('scroll'))
      })
      await mount({ state: streaming('ab') })
      expect(scroller().scrollTop).toBe(1000)
    })

    it('stays where the reader scrolled up to', async () => {
      await mount({ state: streaming('a') })
      layout(100)
      await act(async () => {
        scroller().dispatchEvent(new Event('scroll'))
      })
      await mount({ state: streaming('ab') })
      expect(scroller().scrollTop).toBe(100)
    })

    it('follows again once the reader is back at the bottom', async () => {
      await mount({ state: streaming('a') })
      layout(100)
      await act(async () => {
        scroller().dispatchEvent(new Event('scroll'))
      })
      layout(560)
      await act(async () => {
        scroller().dispatchEvent(new Event('scroll'))
      })
      await mount({ state: streaming('abc') })
      expect(scroller().scrollTop).toBe(1000)
    })
  })

  it('uses the web Vietnamese wording in vi', async () => {
    await mount({
      lang: 'vi',
      state: { status: 'streaming', question: 'q', conversationId: 'conv-1' },
    })
    expect(host.querySelector('.askuni-v2-working')?.textContent).toContain('UNI đang suy nghĩ…')
  })
})
