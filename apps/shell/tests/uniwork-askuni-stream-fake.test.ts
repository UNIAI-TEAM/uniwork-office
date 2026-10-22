import { describe, expect, it } from 'vitest'
import {
  askUniFakeStreamFlag,
  createFakeAskUniStream,
} from '../src/main/uniwork-askuni/stream-fake'
import { askUniFakeEnabled } from '../src/main/uniwork-askuni/fake'
import type { AskUniStreamPayload } from '../src/main/uniwork-askuni/stream-client'

/**
 * UNI-2076 s1: the streaming Ask UNI fake (UNIWORK_ASKUNI_FAKE=1, unpackaged
 * only) for the renderer slices and tester_visual: the event script and the
 * question prefixes.
 */

const fake = createFakeAskUniStream({ delayMs: 0 })

async function ask(question: string, signal = new AbortController().signal) {
  const events: AskUniStreamPayload[] = []
  const terminal = await fake.stream(
    { workspaceId: 'ws_fake', question, locale: 'en' },
    { signal, onEvent: (e) => events.push(e) },
  )
  return { events, terminal, types: events.map((e) => e.type) }
}

describe('fake gating', () => {
  it('is on only unpackaged with UNIWORK_ASKUNI_FAKE=1', () => {
    expect(askUniFakeEnabled({ UNIWORK_ASKUNI_FAKE: '1' }, false)).toBe(true)
    expect(askUniFakeEnabled({ UNIWORK_ASKUNI_FAKE: '1' }, true)).toBe(false)
    expect(askUniFakeEnabled({}, false)).toBe(false)
  })

  it('the fake flag is on unless UNIWORK_ASKUNI_FAKE_STREAM=0', () => {
    expect(askUniFakeStreamFlag({})).toBe(true)
    expect(askUniFakeStreamFlag({ UNIWORK_ASKUNI_FAKE_STREAM: '1' })).toBe(true)
    expect(askUniFakeStreamFlag({ UNIWORK_ASKUNI_FAKE_STREAM: '0' })).toBe(false)
  })
})

describe('fake stream script', () => {
  it('a plain question: run, two steps, deltas, citations, done', async () => {
    const { types, events, terminal } = await ask('docs: budget')
    expect(types[0]).toBe('run')
    expect(types.filter((t) => t === 'step')).toHaveLength(2)
    expect(types.filter((t) => t === 'delta').length).toBeGreaterThan(2)
    expect(types).toContain('citations')
    expect(terminal.type).toBe('done')
    const text = events.map((e) => (e.type === 'delta' ? e.text : '')).join('')
    expect(terminal.type === 'done' && terminal.message.content).toBe(text)
    expect(terminal.type === 'done' && terminal.message.citations.length).toBeGreaterThan(0)
  })

  it('none: is a done with no_sources', async () => {
    const { terminal } = await ask('none: x')
    expect(terminal).toMatchObject({ type: 'done', message: { notice: 'no_sources' } })
  })

  it.each([
    ['quota: x', { type: 'error', code: 'quota' }],
    ['rate: x', { type: 'error', code: 'rate_limited', retryAfterSeconds: 30 }],
    ['forbidden: x', { type: 'error', code: 'forbidden' }],
    ['offline: x', { type: 'error', code: 'offline' }],
    ['disabled: x', { type: 'error', code: 'disabled' }],
  ])('%s fails before any event', async (question, expected) => {
    const { events, terminal } = await ask(question)
    expect(events).toEqual([])
    expect(terminal).toEqual(expected)
  })

  it('drop: ends without done (stream_ended)', async () => {
    const { types, terminal } = await ask('drop: x')
    expect(types).toContain('delta')
    expect(terminal).toEqual({ type: 'error', code: 'stream_ended' })
  })

  it('err: sends an error mid-stream', async () => {
    const { types, terminal } = await ask('err: x')
    expect(types).toContain('delta')
    expect(terminal).toEqual({ type: 'error', code: 'provider_error' })
  })

  it('slow: streams long enough to be stopped; an abort ends it as cancelled', async () => {
    const slow = createFakeAskUniStream({ delayMs: 5 })
    const controller = new AbortController()
    const events: AskUniStreamPayload[] = []
    const done = slow.stream(
      { workspaceId: 'ws_fake', question: 'slow: x', locale: 'en' },
      {
        signal: controller.signal,
        onEvent: (e) => {
          events.push(e)
          if (events.filter((x) => x.type === 'delta').length === 3) controller.abort()
        },
      },
    )
    expect(await done).toEqual({ type: 'error', code: 'cancelled' })
    expect(events.filter((e) => e.type === 'delta')).toHaveLength(3)
  })

  it('keeps the asked conversation id', async () => {
    const events: AskUniStreamPayload[] = []
    await fake.stream(
      { workspaceId: 'ws_fake', conversationId: 'conv_1', question: 'hi', locale: 'en' },
      { signal: new AbortController().signal, onEvent: (e) => events.push(e) },
    )
    expect(events[0]).toMatchObject({ type: 'run', conversationId: 'conv_1' })
  })
})
