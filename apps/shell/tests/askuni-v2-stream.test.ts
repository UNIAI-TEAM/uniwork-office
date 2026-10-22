// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useAskUniStream,
  useStreamFocus,
  type AskStreamApi,
  type UseAskUniStreamOptions,
} from '../src/renderer/src/askuni-v2/use-ask-uni-stream'
import { hasAskUniV2Bridge } from '../src/renderer/src/askuni-v2/bridge'
import type {
  AskUniMessage,
  AskUniStreamEvent,
  AskUniStreamRequest,
  AskUniStreamStart,
} from '../src/shared/askuni-api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CITE = {
  sourceId: 'S1',
  kind: 'document' as const,
  title: 'Q3 plan.docx',
  quote: 'Budget is frozen',
  href: '/o/w/documents/1',
}

function message(over: Partial<AskUniMessage> = {}): AskUniMessage {
  return {
    id: 'm-1',
    role: 'assistant',
    content: 'The budget is frozen [S1].',
    citations: [CITE],
    createdAt: '2026-10-22T03:00:00Z',
    ...over,
  }
}

describe('Ask UNI v2 stream hook', () => {
  let host: HTMLDivElement
  let root: Root
  let api: AskStreamApi
  let listener: ((ev: AskUniStreamEvent) => void) | null
  let unsubscribe: ReturnType<typeof vi.fn<() => void>>
  let subscribeCalls: number
  let askUniStream: ReturnType<
    typeof vi.fn<(req: AskUniStreamRequest) => Promise<AskUniStreamStart>>
  >
  let askUniStreamCancel: ReturnType<
    typeof vi.fn<(req: { requestId: string }) => Promise<{ ok: true }>>
  >
  let counter: number

  function install(extra: Record<string, unknown> = {}): void {
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {
      askUniStream,
      askUniStreamCancel,
      onAskUniStreamEvent: (cb: (ev: AskUniStreamEvent) => void) => {
        subscribeCalls += 1
        listener = cb
        return unsubscribe
      },
      ...extra,
    }
  }

  function Probe(props: { workspaceId: string | null; options?: UseAskUniStreamOptions }) {
    api = useAskUniStream({ workspaceId: props.workspaceId, ...props.options })
    return null
  }

  async function mount(
    workspaceId: string | null = 'ws-1',
    options?: UseAskUniStreamOptions,
  ): Promise<void> {
    await act(async () => {
      root.render(h(Probe, { workspaceId, options }))
    })
  }

  async function emit(ev: AskUniStreamEvent): Promise<void> {
    await act(async () => {
      listener?.(ev)
    })
  }

  async function ask(question = 'What is blocked?', extra: Record<string, unknown> = {}) {
    await act(async () => {
      api.ask({ question, locale: 'en', ...extra })
      await Promise.resolve()
    })
  }

  const ev = {
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
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    listener = null
    subscribeCalls = 0
    counter = 0
    unsubscribe = vi.fn()
    askUniStream = vi.fn(async () => ({ ok: true as const, requestId: `r${++counter}` }))
    askUniStreamCancel = vi.fn(async () => ({ ok: true as const }))
    install()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
  })

  describe('bridge', () => {
    it('detects the v2 bridge by its stream methods', () => {
      expect(hasAskUniV2Bridge()).toBe(true)
      ;(window as unknown as { aiOffice: unknown }).aiOffice = { askUniStream }
      expect(hasAskUniV2Bridge()).toBe(false)
      ;(window as unknown as { aiOffice: unknown }).aiOffice = {}
      expect(hasAskUniV2Bridge()).toBe(false)
    })
  })

  describe('starting a turn', () => {
    it('starts idle', async () => {
      await mount()
      expect(api.state).toMatchObject({
        status: 'idle',
        question: '',
        conversationId: null,
        draft: '',
        counts: {},
        citations: [],
        message: null,
        errorCode: null,
      })
    })

    it('sends the workspace, question and options through askUniStream and starts streaming', async () => {
      await mount('ws-7')
      await ask('Who owns billing?', {
        conversationId: 'conv-4',
        model: 'sonnet',
        effort: 'high',
        focus: { kind: 'document', id: 'd1' },
      })
      expect(askUniStream).toHaveBeenCalledTimes(1)
      expect(askUniStream.mock.calls[0]![0]).toEqual({
        workspaceId: 'ws-7',
        question: 'Who owns billing?',
        locale: 'en',
        conversationId: 'conv-4',
        model: 'sonnet',
        effort: 'high',
        focus: { kind: 'document', id: 'd1' },
      })
      expect(api.state.status).toBe('streaming')
      expect(api.state.question).toBe('Who owns billing?')
      expect(api.state.conversationId).toBe('conv-4')
    })

    it('subscribes to the event channel once and unsubscribes on unmount', async () => {
      await mount()
      await ask('one')
      await ask('two')
      expect(subscribeCalls).toBe(1)
      await act(async () => root.unmount())
      expect(unsubscribe).toHaveBeenCalledTimes(1)
      root = createRoot(host)
    })

    it('fails with `error` when the bridge has no stream method', async () => {
      ;(window as unknown as { aiOffice: unknown }).aiOffice = {}
      await mount()
      await ask()
      expect(api.state.status).toBe('error')
      expect(api.state.errorCode).toBe('error')
    })

    it('fails with `error` without a workspace', async () => {
      await mount(null)
      await ask()
      expect(askUniStream).not.toHaveBeenCalled()
      expect(api.state.status).toBe('error')
      expect(api.state.errorCode).toBe('error')
    })

    it('shows the failure code and the wait of a refused start', async () => {
      askUniStream.mockResolvedValueOnce({
        ok: false,
        error: 'rate_limited',
        retryAfterSeconds: 30,
      })
      await mount()
      await ask()
      expect(api.state.status).toBe('error')
      expect(api.state.errorCode).toBe('rate_limited')
      expect(api.state.retryAfterSeconds).toBe(30)
    })

    it('maps a thrown start to `error`', async () => {
      askUniStream.mockRejectedValueOnce(new Error('boom'))
      await mount()
      await ask()
      expect(api.state.status).toBe('error')
      expect(api.state.errorCode).toBe('error')
    })
  })

  describe('events', () => {
    it('keeps the conversation named by `run` and tells the owner once', async () => {
      const onConversation = vi.fn()
      await mount('ws-1', { onConversation })
      await ask()
      await emit(ev.run('r1', 'conv-9'))
      expect(api.state.conversationId).toBe('conv-9')
      expect(onConversation).toHaveBeenCalledExactlyOnceWith('conv-9')
    })

    it('appends deltas to the draft and a step clears it and sums the counts', async () => {
      await mount()
      await ask()
      await emit(ev.delta('Let me '))
      await emit(ev.delta('look'))
      expect(api.state.draft).toBe('Let me look')
      await emit(ev.step({ task: 3, document: 1 }))
      expect(api.state.draft).toBe('')
      expect(api.state.counts).toEqual({ task: 3, document: 1 })
      await emit(ev.step({ task: 2 }))
      expect(api.state.counts).toEqual({ task: 5, document: 1 })
      await emit(ev.delta('Final'))
      expect(api.state.draft).toBe('Final')
    })

    it('keeps the citations as they arrive', async () => {
      await mount()
      await ask()
      await emit({ type: 'citations', requestId: 'r1', citations: [CITE] })
      expect(api.state.citations).toEqual([CITE])
    })

    it('finishes with the stored message on `done`', async () => {
      const onSettled = vi.fn()
      await mount('ws-1', { onSettled })
      await ask()
      await emit(ev.run())
      await emit({ type: 'done', requestId: 'r1', message: message() })
      expect(api.state.status).toBe('done')
      expect(api.state.message?.id).toBe('m-1')
      expect(onSettled).toHaveBeenCalledWith({ status: 'done', conversationId: 'conv-1' })
    })

    it('a `done` carrying the stopped notice is a stopped turn', async () => {
      await mount()
      await ask()
      await emit({ type: 'done', requestId: 'r1', message: message({ notice: 'stopped' }) })
      expect(api.state.status).toBe('stopped')
    })

    it('ends with the code and wait of an `error` event', async () => {
      const onSettled = vi.fn()
      await mount('ws-1', { onSettled })
      await ask()
      await emit({ type: 'error', requestId: 'r1', code: 'rate_limited', retryAfterSeconds: 12 })
      expect(api.state).toMatchObject({
        status: 'error',
        errorCode: 'rate_limited',
        retryAfterSeconds: 12,
      })
      expect(onSettled).toHaveBeenCalledWith({ status: 'error', conversationId: null })
    })

    it('surfaces stream_ended (the body ended without a done) as an error', async () => {
      await mount()
      await ask()
      await emit(ev.delta('half an ans'))
      await emit({ type: 'error', requestId: 'r1', code: 'stream_ended' })
      expect(api.state.status).toBe('error')
      expect(api.state.errorCode).toBe('stream_ended')
    })

    it('ignores events of other requests and events after the end', async () => {
      await mount()
      await ask()
      await emit(ev.delta('mine'))
      await emit(ev.delta('theirs', 'other-request'))
      expect(api.state.draft).toBe('mine')
      await emit({ type: 'done', requestId: 'r1', message: message() })
      await emit(ev.delta('late'))
      await emit({ type: 'error', requestId: 'r1', code: 'error' })
      expect(api.state.status).toBe('done')
      expect(api.state.draft).toBe('mine')
    })

    it('replays events that arrive before the start call has answered', async () => {
      let resolveStart: (s: AskUniStreamStart) => void = () => undefined
      askUniStream.mockImplementationOnce(
        () =>
          new Promise<AskUniStreamStart>((res) => {
            resolveStart = res
          }),
      )
      await mount()
      await ask()
      await emit(ev.run('r5', 'conv-5'))
      await emit(ev.delta('early', 'r5'))
      await emit(ev.delta('foreign', 'not-r5'))
      expect(api.state.draft).toBe('')
      await act(async () => {
        resolveStart({ ok: true, requestId: 'r5' })
      })
      expect(api.state.conversationId).toBe('conv-5')
      expect(api.state.draft).toBe('early')
    })
  })

  describe('cancelling', () => {
    it('a new ask cancels the old request and drops its late events', async () => {
      await mount()
      await ask('first')
      await ask('second')
      expect(askUniStreamCancel).toHaveBeenCalledWith({ requestId: 'r1' })
      await emit(ev.delta('old text', 'r1'))
      expect(api.state.draft).toBe('')
      await emit(ev.delta('new text', 'r2'))
      expect(api.state.question).toBe('second')
      expect(api.state.draft).toBe('new text')
    })

    it('cancels a request whose start answers after it was replaced', async () => {
      let resolveFirst: (s: AskUniStreamStart) => void = () => undefined
      askUniStream.mockImplementationOnce(
        () =>
          new Promise<AskUniStreamStart>((res) => {
            resolveFirst = res
          }),
      )
      await mount()
      await ask('first')
      await ask('second')
      await act(async () => {
        resolveFirst({ ok: true, requestId: 'late-one' })
      })
      expect(askUniStreamCancel).toHaveBeenCalledWith({ requestId: 'late-one' })
      expect(api.state.question).toBe('second')
    })

    it('cancels the running request on unmount', async () => {
      await mount()
      await ask()
      await act(async () => root.unmount())
      expect(askUniStreamCancel).toHaveBeenCalledWith({ requestId: 'r1' })
      root = createRoot(host)
    })

    it('a workspace switch cancels the running request and resets to idle', async () => {
      await mount('ws-1')
      await ask()
      await emit(ev.delta('partial'))
      await mount('ws-2')
      expect(askUniStreamCancel).toHaveBeenCalledWith({ requestId: 'r1' })
      expect(api.state.status).toBe('idle')
      expect(api.state.draft).toBe('')
    })

    it('Stop cancels the request, marks the turn stopped and keeps what was written', async () => {
      const onSettled = vi.fn()
      await mount('ws-1', { onSettled })
      await ask()
      await emit(ev.run())
      await emit(ev.delta('partial answer'))
      await act(async () => api.stop())
      expect(askUniStreamCancel).toHaveBeenCalledWith({ requestId: 'r1' })
      expect(api.state.status).toBe('stopped')
      expect(api.state.draft).toBe('partial answer')
      expect(onSettled).toHaveBeenCalledWith({ status: 'stopped', conversationId: 'conv-1' })
      // the events of the stopped request no longer count
      await emit({ type: 'error', requestId: 'r1', code: 'cancelled' })
      expect(api.state.status).toBe('stopped')
    })

    it('Stop asks the owner to reload the conversation now and again after ~1.5 s', async () => {
      vi.useFakeTimers()
      await mount()
      await ask()
      await emit(ev.run())
      const before = api.state.reloadTick
      await act(async () => api.stop())
      expect(api.state.reloadTick).toBeGreaterThan(before)
      const afterStop = api.state.reloadTick
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1400)
      })
      expect(api.state.reloadTick).toBe(afterStop)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(api.state.reloadTick).toBeGreaterThan(afterStop)
    })

    it('Stop before the start call answered still cancels once it has an id', async () => {
      let resolveStart: (s: AskUniStreamStart) => void = () => undefined
      askUniStream.mockImplementationOnce(
        () =>
          new Promise<AskUniStreamStart>((res) => {
            resolveStart = res
          }),
      )
      await mount()
      await ask()
      await act(async () => api.stop())
      expect(api.state.status).toBe('stopped')
      expect(askUniStreamCancel).not.toHaveBeenCalled()
      await act(async () => {
        resolveStart({ ok: true, requestId: 'slow' })
      })
      expect(askUniStreamCancel).toHaveBeenCalledWith({ requestId: 'slow' })
    })

    it('Stop outside a running turn does nothing', async () => {
      await mount()
      await act(async () => api.stop())
      expect(api.state.status).toBe('idle')
      expect(askUniStreamCancel).not.toHaveBeenCalled()
    })

    it('a cancel that rejects is swallowed', async () => {
      askUniStreamCancel.mockRejectedValue(new Error('gone'))
      await mount()
      await ask()
      await act(async () => api.stop())
      expect(api.state.status).toBe('stopped')
    })
  })

  describe('retry', () => {
    it('asks the same question again with the same options', async () => {
      await mount()
      await ask('Retry me', { model: 'opus', effort: 'low' })
      await emit({ type: 'error', requestId: 'r1', code: 'provider_error' })
      await act(async () => {
        api.retry()
        await Promise.resolve()
      })
      expect(askUniStream).toHaveBeenCalledTimes(2)
      expect(askUniStream.mock.calls[1]![0]).toMatchObject({
        question: 'Retry me',
        model: 'opus',
        effort: 'low',
      })
      expect(api.state.status).toBe('streaming')
    })

    it('does nothing before any question was asked', async () => {
      await mount()
      await act(async () => api.retry())
      expect(askUniStream).not.toHaveBeenCalled()
    })
  })
})

describe('Ask UNI v2 stream focus', () => {
  let host: HTMLDivElement
  let root: Root

  function Focus(props: { streaming: boolean }) {
    useStreamFocus(
      props.streaming,
      () => document.getElementById('stop'),
      () => document.getElementById('composer'),
    )
    return h(
      'div',
      null,
      h('textarea', { id: 'composer' }),
      props.streaming ? h('button', { id: 'stop' }, 'Stop') : null,
      h('button', { id: 'other' }, 'Other'),
    )
  }

  async function render(streaming: boolean): Promise<void> {
    await act(async () => {
      root.render(h(Focus, { streaming }))
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('moves focus to Stop while streaming and back to the composer after', async () => {
    await render(false)
    await render(true)
    expect(document.activeElement?.id).toBe('stop')
    await render(false)
    expect(document.activeElement?.id).toBe('composer')
  })

  it('leaves focus alone when the user moved it somewhere else meanwhile', async () => {
    await render(false)
    await render(true)
    document.getElementById('other')?.focus()
    await render(false)
    expect(document.activeElement?.id).toBe('other')
  })
})
