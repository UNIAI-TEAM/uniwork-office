import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UniworkConversations } from '../src/uniwork/conversation'
import { UniworkError } from '../src/uniwork/errors'
import { streamUniwork, type UniworkTurnRequest } from '../src/uniwork/protocol'
import type { UniworkChatTransport } from '../src/uniwork/types'
import type { StreamCallbacks } from '../src/protocols/shared'
import {
  AI_CONNECT_TIMEOUT_MS,
  AI_IDLE_TIMEOUT_MS,
  AiTimeoutError,
  createStreamWatchdog,
} from '../src/watchdog'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** promise that rejects when the given signal aborts (models a fetch/body read) */
function abortable(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'))
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
}

describe('createStreamWatchdog', () => {
  it('aborts and reports AiTimeoutError when nothing arrives within the connect timeout', async () => {
    const wd = createStreamWatchdog(undefined, 1_000, 5_000)
    const run = wd.guard(() => abortable(wd.signal))
    const result = expect(run).rejects.toBeInstanceOf(AiTimeoutError)
    await vi.advanceTimersByTimeAsync(1_000)
    await result
  })

  it('touch() switches to the idle timeout and re-arms it on every call', async () => {
    const wd = createStreamWatchdog(undefined, 1_000, 2_000)
    const run = wd.guard(() => abortable(wd.signal))
    const result = expect(run).rejects.toBeInstanceOf(AiTimeoutError)
    await vi.advanceTimersByTimeAsync(900)
    wd.touch() // data arrived: idle timeout from now on
    await vi.advanceTimersByTimeAsync(1_900)
    expect(wd.signal.aborted).toBe(false)
    wd.touch()
    await vi.advanceTimersByTimeAsync(1_900)
    expect(wd.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(wd.signal.aborted).toBe(true)
    await result
  })

  it('a caller abort propagates and keeps the original error (not AiTimeoutError)', async () => {
    const parent = new AbortController()
    const wd = createStreamWatchdog(parent.signal, 1_000, 1_000)
    const run = wd.guard(() => abortable(wd.signal))
    parent.abort()
    await expect(run).rejects.toThrow('aborted')
  })

  it('an already-aborted caller signal aborts immediately', () => {
    const parent = new AbortController()
    parent.abort()
    const wd = createStreamWatchdog(parent.signal)
    expect(wd.signal.aborted).toBe(true)
  })

  it('success resolves and disposes the timer (no abort after completion)', async () => {
    const wd = createStreamWatchdog(undefined, 1_000, 1_000)
    await expect(wd.guard(() => Promise.resolve('ok'))).resolves.toBe('ok')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(wd.signal.aborted).toBe(false)
  })

  it('non-timeout errors pass through unchanged', async () => {
    const wd = createStreamWatchdog(undefined, 1_000, 1_000)
    await expect(wd.guard(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
  })
})

describe('UniWork AI turn timeouts end to end', () => {
  const turn: UniworkTurnRequest = {
    scope: { kind: 'org', orgId: 'org-1', format: 'docx' },
    messages: [{ role: 'user', text: 'hi' }],
    tools: [],
    toolPolicy: { cloudTools: false },
  }
  const collector = () => {
    const deltas: string[] = []
    return {
      deltas,
      cb: {
        signal: new AbortController().signal,
        onDelta: (text: string) => deltas.push(text),
        onToolCall: () => {},
      },
    }
  }
  const run = (transport: UniworkChatTransport, cb: StreamCallbacks) =>
    streamUniwork(transport, turn, cb, { conversations: new UniworkConversations() })
  const timedOut = (e: unknown) => e instanceof UniworkError && e.code === 'ai_provider_timeout'

  it('times out when the connection never yields a response', async () => {
    const transport: UniworkChatTransport = { post: ({ signal }) => abortable(signal) }
    const result = run(transport, collector().cb).then(
      () => null,
      (e: unknown) => e,
    )
    await vi.advanceTimersByTimeAsync(AI_CONNECT_TIMEOUT_MS)
    expect(timedOut(await result)).toBe(true)
  })

  it('times out when an open stream goes silent, keeping what arrived', async () => {
    const encoder = new TextEncoder()
    const transport: UniworkChatTransport = {
      post: ({ signal }) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n'))
            // stays open forever; reads reject once the watchdog aborts
            signal.addEventListener('abort', () => controller.error(new Error('aborted')))
          },
        })
        return Promise.resolve(new Response(body, { status: 200 }))
      },
    }
    const { deltas, cb } = collector()
    const result = run(transport, cb).then(
      () => null,
      (e: unknown) => e,
    )
    await vi.advanceTimersByTimeAsync(AI_IDLE_TIMEOUT_MS + 1_000)
    expect(timedOut(await result)).toBe(true)
    expect(deltas).toEqual(['hi'])
  })

  it('reports wire activity through onActivity', async () => {
    const encoder = new TextEncoder()
    const transport: UniworkChatTransport = {
      post: () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n',
              ),
            )
            controller.close()
          },
        })
        return Promise.resolve(new Response(body, { status: 200 }))
      },
    }
    const onActivity = vi.fn()
    await run(transport, { ...collector().cb, onActivity })
    expect(onActivity).toHaveBeenCalled()
  })
})
