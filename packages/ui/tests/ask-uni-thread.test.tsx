/** @vitest-environment jsdom */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskUniMessagesResult } from '@genoffice/ai-provider/askuni'
import {
  AskUniAdapterProvider,
  AskUniThread,
  clearAskUniRatings,
  type AskStreamState,
  type AskUniStreamHandle,
} from '../src/ask-uni'
import { askUniText } from '../src/strings-ask-uni'
import { CITE, fakeAdapter, msg, type FakeAdapter } from './ask-uni-kit'

// The message area over an injected adapter (ported from the shell thread tests, which keep running
// through the shell wrapper): stored turns, the live turn, errors, the one polite live region.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const en = (key: Parameters<typeof askUniText>[1]) => askUniText('en', key)

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

describe('AskUniThread (adapter)', () => {
  let host: HTMLDivElement
  let root: Root
  let fake: FakeAdapter
  let stored: ReturnType<typeof msg>[]
  let stream: AskUniStreamHandle
  let onRegenerate: ReturnType<typeof vi.fn<(q: string) => void>>

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
      onStatus?: (text: string) => void
    } = {},
  ): Promise<void> {
    if (over.lang) fake = { ...fake, adapter: fakeAdapter(over.lang).adapter }
    stream = streamWith(over.state)
    await act(async () => {
      root.render(
        h(AskUniAdapterProvider, {
          adapter: fake.adapter,
          children: h(AskUniThread, {
            conversationId: over.conversationId === undefined ? 'conv-1' : over.conversationId,
            stream,
            onRegenerate,
            onStatus: over.onStatus,
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
    fake = fakeAdapter()
    stored = [
      msg('u1', 'user', 'What is blocked?'),
      msg('a1', 'assistant', 'Billing is blocked [S1].', { citations: [CITE] }),
      msg('u2', 'user', 'And next week?'),
      msg('a2', 'assistant', 'Nothing yet.'),
    ]
    fake.loadMessages.mockImplementation(async () => ({ ok: true as const, messages: stored }))
    onRegenerate = vi.fn()
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
    it('loads the conversation through the adapter and shows its turns in order', async () => {
      await mount()
      expect(fake.loadMessages).toHaveBeenCalledExactlyOnceWith('conv-1')
      expect(turns().map((t) => t.textContent)).toEqual([
        expect.stringContaining('What is blocked?'),
        expect.stringContaining('Billing is blocked'),
        expect.stringContaining('And next week?'),
        expect.stringContaining('Nothing yet.'),
      ])
    })

    it('accepts a plain message array from the adapter', async () => {
      fake.loadMessages.mockResolvedValue(stored)
      await mount()
      expect(turns()).toHaveLength(4)
    })

    it('has no stored turns and no load for a new conversation', async () => {
      await mount({ conversationId: null })
      expect(fake.loadMessages).not.toHaveBeenCalled()
      expect(turns()).toHaveLength(0)
    })

    it('reloads when the conversation changes, replacing the old turns', async () => {
      await mount()
      fake.loadMessages.mockResolvedValue({ ok: true, messages: [msg('x1', 'user', 'Other chat')] })
      await mount({ conversationId: 'conv-2' })
      expect(fake.loadMessages).toHaveBeenLastCalledWith('conv-2')
      expect(turns()).toHaveLength(1)
      expect(host.textContent).not.toContain('Billing')
    })

    it('reloads when the stream asks for it and keeps the turns when the reload fails', async () => {
      await mount()
      fake.loadMessages.mockResolvedValueOnce({ ok: false, error: 'offline' })
      await mount({ state: { reloadTick: 1 } })
      expect(fake.loadMessages).toHaveBeenCalledTimes(2)
      expect(turns()).toHaveLength(4)
      fake.loadMessages.mockRejectedValueOnce(new Error('x'))
      await mount({ state: { reloadTick: 2 } })
      expect(turns()).toHaveLength(4)
    })

    it('marks the list busy while a stored conversation is loading', async () => {
      let resolve: (r: AskUniMessagesResult) => void = () => undefined
      fake.loadMessages.mockImplementationOnce(
        () =>
          new Promise<AskUniMessagesResult>((res) => {
            resolve = res
          }),
      )
      await mount()
      expect(host.querySelector('.askuni-v2-turns')?.getAttribute('aria-busy')).toBe('true')
      expect(turns()).toHaveLength(0)
      await act(async () => resolve({ ok: true, messages: stored }))
      await flush()
      expect(host.querySelector('.askuni-v2-turns')?.getAttribute('aria-busy')).toBe('false')
      expect(turns()).toHaveLength(4)
    })

    it('a first load that fails shows the error and a Retry that loads again', async () => {
      fake.loadMessages.mockResolvedValueOnce({ ok: false, error: 'offline' })
      await mount()
      expect(host.textContent).toContain(en('askUniErrDefault'))
      expect(host.querySelector('.askuni-v2-turns')?.getAttribute('aria-busy')).toBe('false')
      const retry = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === en('askUniV2Retry'),
      )
      expect(retry).toBeDefined()
      await act(async () => retry!.click())
      await flush()
      expect(fake.loadMessages).toHaveBeenCalledTimes(2)
      expect(turns()).toHaveLength(4)
      expect(host.textContent).not.toContain(en('askUniErrDefault'))
    })

    it('announces a failed first load to assistive tech (role alert on the error line)', async () => {
      fake.loadMessages.mockResolvedValueOnce({ ok: false, error: 'offline' })
      await mount()
      const line = host.querySelector('li.askuni-v2-error')
      expect(line?.getAttribute('role')).toBe('alert')
      expect(line?.textContent).toContain(en('askUniErrDefault'))
    })

    it('a rejected first load reads the same, and a failed reload after a good load shows no error', async () => {
      fake.loadMessages.mockRejectedValueOnce(new Error('x'))
      await mount()
      expect(host.textContent).toContain(en('askUniErrDefault'))
      await mount({ state: { reloadTick: 1 } })
      expect(turns()).toHaveLength(4)
      fake.loadMessages.mockResolvedValueOnce({ ok: false, error: 'offline' })
      await mount({ state: { reloadTick: 2 } })
      expect(turns()).toHaveLength(4)
      expect(host.textContent).not.toContain(en('askUniErrDefault'))
    })

    it('drops the answer of a load that finished after the conversation changed', async () => {
      let resolveOld: (r: AskUniMessagesResult) => void = () => undefined
      fake.loadMessages.mockImplementationOnce(
        () =>
          new Promise<AskUniMessagesResult>((res) => {
            resolveOld = res
          }),
      )
      await mount()
      fake.loadMessages.mockResolvedValue({ ok: true, messages: [msg('n1', 'user', 'New chat')] })
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

  describe('regenerate and feedback', () => {
    it('hands the last question to the owner, which resends it', async () => {
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

    it('sends a rating through the adapter feedback call', async () => {
      await mount()
      await act(async () => {
        ;(host.querySelectorAll('button[aria-label="Helpful"]')[1] as HTMLButtonElement).click()
        await Promise.resolve()
      })
      expect(fake.feedbackSet).toHaveBeenCalledExactlyOnceWith({
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
      expect(host.querySelector('.askuni-v2-working')?.textContent).toContain(en('askUniThinking'))
    })

    it('shows the draft with the citations that already arrived, and the step summary', async () => {
      await mount({
        state: live({ draft: 'Lan owns it [S1]', citations: [CITE], counts: { task: 3 } }),
      })
      const last = turns()[5]!
      expect(last.textContent).toContain('Lan owns it')
      expect(last.textContent).toContain('Looked at 3 tasks')
      expect(last.querySelector('[aria-label="Source 1: Q3 plan.docx"]')).not.toBeNull()
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
      expect(host.textContent).toContain(en('askUniV2NoticeStopped'))
      expect(copyBtns()).toHaveLength(0)
      expect(host.querySelector('button[aria-label="Helpful"]')).toBeNull()
    })

    it('a stopped turn disappears once the reload brought its question and partial answer', async () => {
      await mount({ state: live({ draft: 'Half an ans' }) })
      await mount({ state: live({ status: 'stopped', draft: 'Half an ans' }) })
      expect(turns()).toHaveLength(6)
      fake.loadMessages.mockResolvedValue({
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
      ['offline', 'askUniErrOffline'],
      ['quota', 'askUniErrQuota'],
      ['forbidden', 'askUniErrForbidden'],
      ['signed_out', 'askUniSignedOut'],
      ['error', 'askUniErrDefault'],
      ['provider_error', 'askUniV2ErrProviderError'],
      ['stream_ended', 'askUniV2ErrStreamEnded'],
    ] as const)('shows the wording for %s under the question', async (code, key) => {
      await mount({ state: failed(code) })
      expect(turns()[4]?.textContent).toContain('Who owns billing?')
      expect(host.textContent).toContain(en(key))
    })

    it('says how long to wait on a rate limit', async () => {
      await mount({ state: failed('rate_limited', { retryAfterSeconds: 12.2 }) })
      expect(host.textContent).toContain('try again in 13 seconds')
    })

    it('retry keeps the question and asks it again; some codes offer none', async () => {
      await mount({ state: failed('provider_error') })
      const retry = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === en('askUniV2Retry'),
      )
      await act(async () => retry!.click())
      expect(stream.retry).toHaveBeenCalledTimes(1)
      await mount({ state: failed('quota') })
      expect(
        [...host.querySelectorAll('button')].some((b) => b.textContent === en('askUniV2Retry')),
      ).toBe(false)
    })
  })

  describe('the live region', () => {
    it('renders its own single polite region that announces the status, not every delta', async () => {
      await mount({
        state: { status: 'streaming', question: 'q', conversationId: 'conv-1', draft: 'x' },
      })
      const regions = host.querySelectorAll('[aria-live]')
      expect(regions).toHaveLength(1)
      expect(regions[0]?.getAttribute('aria-live')).toBe('polite')
      expect(regions[0]?.textContent).toBe(en('askUniThinking'))
    })

    it('hands the status to the host setter instead of rendering a region of its own', async () => {
      const onStatus = vi.fn()
      await mount({
        onStatus,
        state: { status: 'streaming', question: 'q', conversationId: 'conv-1' },
      })
      expect(host.querySelectorAll('[aria-live]')).toHaveLength(0)
      expect(onStatus).toHaveBeenLastCalledWith(en('askUniThinking'))
      await mount({
        onStatus,
        state: {
          status: 'done',
          question: 'q',
          conversationId: 'conv-1',
          message: msg('a9', 'assistant', 'Done'),
        },
      })
      expect(onStatus).toHaveBeenLastCalledWith(en('askUniV2AnswerReady'))
    })

    it('clears the host status when the thread goes away', async () => {
      const onStatus = vi.fn()
      await mount({
        onStatus,
        state: { status: 'streaming', question: 'q', conversationId: 'conv-1' },
      })
      await act(async () => root.unmount())
      expect(onStatus).toHaveBeenLastCalledWith('')
      root = createRoot(host)
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

    it('follows the answer while the reader is at the bottom, not after scrolling up', async () => {
      await mount({ state: streaming('a') })
      layout(600)
      await act(async () => {
        scroller().dispatchEvent(new Event('scroll'))
      })
      await mount({ state: streaming('ab') })
      expect(scroller().scrollTop).toBe(1000)
      layout(100)
      await act(async () => {
        scroller().dispatchEvent(new Event('scroll'))
      })
      await mount({ state: streaming('abc') })
      expect(scroller().scrollTop).toBe(100)
    })
  })

  it('uses the Vietnamese wording in vi', async () => {
    await mount({
      lang: 'vi',
      state: { status: 'streaming', question: 'q', conversationId: 'conv-1' },
    })
    expect(host.querySelector('.askuni-v2-working')?.textContent).toContain('UNI đang suy nghĩ…')
  })
})
