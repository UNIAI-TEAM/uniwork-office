/** @vitest-environment jsdom */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskUniStreamEvent, AskUniStreamStart } from '@genoffice/ai-provider/askuni'
import {
  useAskUniStream,
  type AskUniAdapter,
  type AskUniStreamHandle,
  type UseAskUniStreamOptions,
} from '../src/ask-uni'
import { CITE, ev, fakeAdapter, message, type FakeAdapter } from './ask-uni-kit'

// The stream hook of Ask UNI over an injected adapter (ported from the shell hook tests, which keep
// running through the shell wrapper): one turn at a time, early events replayed, a replaced or stopped
// request cancelled, and no workspace id invented for a host that has none (the editors).

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Ask UNI stream hook (adapter)', () => {
  let host: HTMLDivElement
  let root: Root
  let api: AskUniStreamHandle
  let fake: FakeAdapter
  let adapter: AskUniAdapter

  function Probe(props: { options: UseAskUniStreamOptions; adapter: AskUniAdapter }) {
    api = useAskUniStream(props.adapter, props.options)
    return null
  }

  async function mount(
    options: UseAskUniStreamOptions = { workspaceId: 'ws-1' },
    use: AskUniAdapter = adapter,
  ): Promise<void> {
    await act(async () => {
      root.render(h(Probe, { options, adapter: use }))
    })
  }

  async function emit(event: AskUniStreamEvent): Promise<void> {
    await act(async () => {
      fake.emit(event)
    })
  }

  async function ask(question = 'What is blocked?', extra: Record<string, unknown> = {}) {
    await act(async () => {
      api.ask({ question, locale: 'en', ...extra })
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    fake = fakeAdapter()
    adapter = fake.adapter
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    host.remove()
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

    it('sends the workspace, question and options through the adapter and starts streaming', async () => {
      await mount({ workspaceId: 'ws-7' })
      await ask('Who owns billing?', {
        conversationId: 'conv-4',
        model: 'sonnet',
        effort: 'high',
        focus: { kind: 'document', id: 'd1' },
      })
      expect(fake.stream).toHaveBeenCalledTimes(1)
      expect(fake.stream.mock.calls[0]![0]).toEqual({
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

    it('adds no workspace id when the host has none (an editor)', async () => {
      await mount({})
      await ask('About this file', { conversationId: 'conv-2' })
      const req = fake.stream.mock.calls[0]![0]
      expect(req).toEqual({
        question: 'About this file',
        locale: 'en',
        conversationId: 'conv-2',
      })
      expect('workspaceId' in req).toBe(false)
    })

    it('takes the locale from the adapter language when the ask names none', async () => {
      const vi18 = fakeAdapter('vi')
      fake = vi18
      await mount({ workspaceId: 'ws-1' }, vi18.adapter)
      await act(async () => {
        api.ask({ question: 'Ai giữ ngân sách?' })
        await Promise.resolve()
      })
      expect(vi18.stream.mock.calls[0]![0]).toMatchObject({ locale: 'vi' })
    })

    it('subscribes to the event channel once and unsubscribes on unmount', async () => {
      await mount()
      await ask('one')
      await ask('two')
      expect(fake.subscribed()).toBe(1)
      await act(async () => root.unmount())
      expect(fake.unsubscribe).toHaveBeenCalledTimes(1)
      root = createRoot(host)
    })

    it('fails with `error` without a workspace (null = not ready)', async () => {
      await mount({ workspaceId: null })
      await ask()
      expect(fake.stream).not.toHaveBeenCalled()
      expect(api.state.status).toBe('error')
      expect(api.state.errorCode).toBe('error')
    })

    it('shows the failure code and the wait of a refused start', async () => {
      fake.stream.mockResolvedValueOnce({ ok: false, error: 'rate_limited', retryAfterSeconds: 30 })
      await mount()
      await ask()
      expect(api.state.status).toBe('error')
      expect(api.state.errorCode).toBe('rate_limited')
      expect(api.state.retryAfterSeconds).toBe(30)
    })

    it('maps a thrown start to `error`', async () => {
      fake.stream.mockRejectedValueOnce(new Error('boom'))
      await mount()
      await ask()
      expect(api.state.status).toBe('error')
      expect(api.state.errorCode).toBe('error')
    })
  })

  describe('events', () => {
    it('keeps the conversation named by `run` and tells the owner once', async () => {
      const onConversation = vi.fn()
      await mount({ workspaceId: 'ws-1', onConversation })
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
      await mount({ workspaceId: 'ws-1', onSettled })
      await ask()
      await emit(ev.run())
      await emit(ev.done())
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
      await mount({ workspaceId: 'ws-1', onSettled })
      await ask()
      await emit({ type: 'error', requestId: 'r1', code: 'rate_limited', retryAfterSeconds: 12 })
      expect(api.state).toMatchObject({
        status: 'error',
        errorCode: 'rate_limited',
        retryAfterSeconds: 12,
      })
      expect(onSettled).toHaveBeenCalledWith({ status: 'error', conversationId: null })
    })

    it('ignores events of other requests and events after the end', async () => {
      await mount()
      await ask()
      await emit(ev.delta('mine'))
      await emit(ev.delta('theirs', 'other-request'))
      expect(api.state.draft).toBe('mine')
      await emit(ev.done())
      await emit(ev.delta('late'))
      await emit({ type: 'error', requestId: 'r1', code: 'error' })
      expect(api.state.status).toBe('done')
      expect(api.state.draft).toBe('mine')
    })

    it('replays events that arrive before the start call has answered', async () => {
      let resolveStart: (s: AskUniStreamStart) => void = () => undefined
      fake.stream.mockImplementationOnce(
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
      expect(fake.cancel).toHaveBeenCalledWith('r1')
      await emit(ev.delta('old text', 'r1'))
      expect(api.state.draft).toBe('')
      await emit(ev.delta('new text', 'r2'))
      expect(api.state.question).toBe('second')
      expect(api.state.draft).toBe('new text')
    })

    it('cancels a request whose start answers after it was replaced', async () => {
      let resolveFirst: (s: AskUniStreamStart) => void = () => undefined
      fake.stream.mockImplementationOnce(
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
      expect(fake.cancel).toHaveBeenCalledWith('late-one')
      expect(api.state.question).toBe('second')
    })

    it('cancels the running request on unmount', async () => {
      await mount()
      await ask()
      await act(async () => root.unmount())
      expect(fake.cancel).toHaveBeenCalledWith('r1')
      root = createRoot(host)
    })

    it('a workspace switch cancels the running request and resets to idle', async () => {
      await mount({ workspaceId: 'ws-1' })
      await ask()
      await emit(ev.delta('partial'))
      await mount({ workspaceId: 'ws-2' })
      expect(fake.cancel).toHaveBeenCalledWith('r1')
      expect(api.state.status).toBe('idle')
      expect(api.state.draft).toBe('')
    })

    it('Stop cancels the request, marks the turn stopped and keeps what was written', async () => {
      const onSettled = vi.fn()
      await mount({ workspaceId: 'ws-1', onSettled })
      await ask()
      await emit(ev.run())
      await emit(ev.delta('partial answer'))
      await act(async () => api.stop())
      expect(fake.cancel).toHaveBeenCalledWith('r1')
      expect(api.state.status).toBe('stopped')
      expect(api.state.draft).toBe('partial answer')
      expect(onSettled).toHaveBeenCalledWith({ status: 'stopped', conversationId: 'conv-1' })
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
      fake.stream.mockImplementationOnce(
        () =>
          new Promise<AskUniStreamStart>((res) => {
            resolveStart = res
          }),
      )
      await mount()
      await ask()
      await act(async () => api.stop())
      expect(api.state.status).toBe('stopped')
      expect(fake.cancel).not.toHaveBeenCalled()
      await act(async () => {
        resolveStart({ ok: true, requestId: 'slow' })
      })
      expect(fake.cancel).toHaveBeenCalledWith('slow')
    })

    it('Stop outside a running turn does nothing', async () => {
      await mount()
      await act(async () => api.stop())
      expect(api.state.status).toBe('idle')
      expect(fake.cancel).not.toHaveBeenCalled()
    })

    it('a cancel that rejects is swallowed', async () => {
      fake.cancel.mockRejectedValue(new Error('gone'))
      await mount()
      await ask()
      await act(async () => api.stop())
      expect(api.state.status).toBe('stopped')
    })
  })

  describe('retry and reset', () => {
    it('retry asks the same question again with the same options', async () => {
      await mount()
      await ask('Retry me', { model: 'opus', effort: 'low' })
      await emit({ type: 'error', requestId: 'r1', code: 'provider_error' })
      await act(async () => {
        api.retry()
        await Promise.resolve()
      })
      expect(fake.stream).toHaveBeenCalledTimes(2)
      expect(fake.stream.mock.calls[1]![0]).toMatchObject({
        question: 'Retry me',
        model: 'opus',
        effort: 'low',
      })
      expect(api.state.status).toBe('streaming')
    })

    it('retry does nothing before any question was asked', async () => {
      await mount()
      await act(async () => api.retry())
      expect(fake.stream).not.toHaveBeenCalled()
    })

    it('reset cancels what runs and goes back to idle (New chat)', async () => {
      await mount()
      await ask()
      await emit(ev.delta('partial'))
      await act(async () => api.reset())
      expect(fake.cancel).toHaveBeenCalledWith('r1')
      expect(api.state.status).toBe('idle')
      expect(api.state.question).toBe('')
    })
  })
})
