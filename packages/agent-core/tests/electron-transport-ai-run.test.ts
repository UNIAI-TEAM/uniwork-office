// The desktop renderer reports `aiRun` for every AI turn: exactly one idle per ending path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAiRunTracker,
  createIpcTransport,
  IPC_STREAM_SILENCE_TIMEOUT_MS,
  type AiRunPayload,
  type AgentStreamCallbacks,
  type IpcStreamChunk,
} from '../src'

let sent: AiRunPayload[]

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
})

afterEach(() => {
  vi.useRealTimers()
})

function setup(startImpl?: () => void | Promise<unknown>) {
  let listener: ((chunk: IpcStreamChunk) => void) | undefined
  let requestId = ''
  const cancelled: string[] = []
  const aiRun = createAiRunTracker({ report: (p) => sent.push(p), graceMs: 0 })
  const transport = createIpcTransport<{ provider: string }>({
    onStream: (l) => {
      listener = l
      return () => {
        listener = undefined
      }
    },
    start: (request) => {
      requestId = request.requestId
      return startImpl?.()
    },
    cancel: (id) => cancelled.push(id),
    getSettings: () => ({ provider: 'uniwork' }),
    unknownErrorText: () => 'unknown error',
    timeoutErrorText: () => 'timed out',
    aiRun,
  })
  const cb: AgentStreamCallbacks = {
    onDelta: vi.fn(),
    onToolCall: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    onNotice: vi.fn(),
    onTurnReset: vi.fn(),
  }
  const handle = transport.stream({ system: 's', messages: [], tools: [] }, cb)
  const emit = (chunk: Omit<IpcStreamChunk, 'requestId'>) => listener?.({ requestId, ...chunk })
  return { cb, emit, handle, cancelled, aiRun }
}

const states = () => sent.map((p) => p.state)

describe('aiRun from the IPC transport: one idle per ending path', () => {
  it('running while a stream is open, one idle on done', () => {
    const { emit } = setup()
    expect(states()).toEqual(['running'])
    emit({ type: 'delta', text: 'hi' })
    emit({ type: 'done' })
    emit({ type: 'done' })
    expect(states()).toEqual(['running', 'idle'])
  })

  it('one idle on error', () => {
    const { emit } = setup()
    emit({ type: 'error', error: 'boom' })
    expect(states()).toEqual(['running', 'idle'])
  })

  it('one idle on stop', () => {
    const { handle, emit, cancelled } = setup()
    handle.cancel()
    // the main process answers the cancel with a done chunk
    emit({ type: 'done' })
    expect(cancelled).toHaveLength(1)
    expect(states()).toEqual(['running', 'idle'])
  })

  it('one idle on disconnect (silence watchdog)', () => {
    const { cb } = setup()
    vi.advanceTimersByTime(IPC_STREAM_SILENCE_TIMEOUT_MS + 1)
    expect(cb.onError).toHaveBeenCalledTimes(1)
    expect(states()).toEqual(['running', 'idle'])
  })

  it('one idle when the start request is rejected', async () => {
    setup(() => Promise.reject(new Error('ipc gone')))
    await vi.advanceTimersByTimeAsync(0)
    expect(states()).toEqual(['running', 'idle'])
  })

  it('one idle on 401', () => {
    const { emit, cb } = setup()
    emit({ type: 'error', error: 'session', uniworkCode: 'unauthorized' })
    expect(cb.onError).toHaveBeenCalledTimes(1)
    expect(states()).toEqual(['running', 'idle'])
  })

  it('one idle on sign-out (main aborts the stream, the error chunk arrives)', () => {
    const { emit } = setup()
    emit({ type: 'error', error: 'signed out', uniworkCode: 'session_expired' })
    expect(states()).toEqual(['running', 'idle'])
  })

  it('one idle when a 429 wait gives up; running through the wait itself', () => {
    const { emit, cb } = setup()
    emit({ type: 'notice', notice: { kind: 'rate-limit-wait', seconds: 120, attempt: 1 } })
    emit({ type: 'ping' })
    emit({ type: 'reset' })
    vi.advanceTimersByTime(120_000)
    expect(cb.onNotice).toHaveBeenCalledWith({ kind: 'rate-limit-wait', seconds: 120, attempt: 1 })
    expect(cb.onTurnReset).toHaveBeenCalledTimes(1)
    expect(states()).toEqual(['running'])
    emit({ type: 'error', error: 'slow down', uniworkCode: 'ai_rate_limited', retryAfterSec: 301 })
    expect(states()).toEqual(['running', 'idle'])
  })

  it('every chunk kind keeps the watchdog armed: a 250 s wait with pings does not time out', () => {
    const { emit, cb } = setup()
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(5000)
      emit({ type: 'ping' })
    }
    expect(cb.onError).not.toHaveBeenCalled()
    expect(states()).toEqual(['running'])
  })

  it('a tool step inside the grace continues the same run (no idle between streams)', () => {
    let listener: ((chunk: IpcStreamChunk) => void) | undefined
    let ids: string[] = []
    const aiRun = createAiRunTracker({ report: (p) => sent.push(p), graceMs: 1500 })
    const transport = createIpcTransport<object>({
      onStream: (l) => {
        listener = l
        return () => {}
      },
      start: (r) => {
        ids.push(r.requestId)
      },
      cancel: () => {},
      getSettings: () => ({}),
      unknownErrorText: () => 'x',
      aiRun,
    })
    const cb = { onDelta() {}, onToolCall() {}, onDone() {}, onError() {} }
    transport.stream({ system: '', messages: [], tools: [] }, cb)
    listener?.({ requestId: ids[0]!, type: 'done' })
    vi.advanceTimersByTime(500)
    transport.stream({ system: '', messages: [], tools: [] }, cb)
    listener?.({ requestId: ids[1]!, type: 'done' })
    vi.advanceTimersByTime(1500)
    expect(states()).toEqual(['running', 'idle'])
    ids = []
  })

  it('reports to window.uniworkAiRun when no tracker is injected (and nothing when it is absent)', () => {
    const reportAiRun = vi.fn()
    vi.stubGlobal('window', { uniworkAiRun: { reportAiRun } })
    try {
      let listener: ((chunk: IpcStreamChunk) => void) | undefined
      let id = ''
      const transport = createIpcTransport<object>({
        onStream: (l) => {
          listener = l
          return () => {}
        },
        start: (r) => {
          id = r.requestId
        },
        cancel: () => {},
        getSettings: () => ({}),
        unknownErrorText: () => 'x',
      })
      transport.stream(
        { system: '', messages: [], tools: [] },
        {
          onDelta() {},
          onToolCall() {},
          onDone() {},
          onError() {},
        },
      )
      expect(reportAiRun).toHaveBeenCalledTimes(1)
      expect(reportAiRun.mock.calls[0]![0]).toMatchObject({ state: 'running' })
      listener?.({ requestId: id, type: 'done' })
      vi.advanceTimersByTime(2000)
      expect(reportAiRun).toHaveBeenCalledTimes(2)
      expect(reportAiRun.mock.calls[1]![0]).toMatchObject({ state: 'idle' })
      expect(reportAiRun.mock.calls[1]![0].runId).toBe(reportAiRun.mock.calls[0]![0].runId)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
