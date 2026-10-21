import { describe, expect, it } from 'vitest'
import {
  ASKUNI_FAKE_ENV,
  askUniFakeEnabled,
  createFakeAskUni,
} from '../src/main/uniwork-askuni/fake'
import type { AskUniRequest } from '../src/shared/askuni-api'

/** UNI-2069 s1: the canned Ask UNI answers for the Home renderer and the visual stage. */

const req = (question: string): AskUniRequest => ({
  workspaceId: 'ws_fake',
  question,
  locale: 'en',
})

describe('enablement', () => {
  it('is on only for UNIWORK_ASKUNI_FAKE=1 in an unpackaged build', () => {
    expect(ASKUNI_FAKE_ENV).toBe('UNIWORK_ASKUNI_FAKE')
    expect(askUniFakeEnabled({ UNIWORK_ASKUNI_FAKE: '1' }, false)).toBe(true)
    expect(askUniFakeEnabled({ UNIWORK_ASKUNI_FAKE: '1' }, true)).toBe(false)
    expect(askUniFakeEnabled({}, false)).toBe(false)
    expect(askUniFakeEnabled({ UNIWORK_ASKUNI_FAKE: '0' }, false)).toBe(false)
    expect(askUniFakeEnabled({ UNIWORK_ASKUNI_FAKE: 'true' }, false)).toBe(false)
  })
})

describe('canned answers', () => {
  const fake = createFakeAskUni({ delayMs: 0 })

  it('docs: -> three document citations and one task', async () => {
    const result = await fake.client.ask(req('docs: budget'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message.citations.map((c) => c.kind)).toEqual([
      'document',
      'document',
      'document',
      'task',
    ])
    expect(result.message.notice).toBeUndefined()
    expect(result.message.content).toContain('[S1]')
  })

  it('none: -> no_sources notice', async () => {
    const result = await fake.client.ask(req('none: anything'))
    expect(result.ok && result.message.notice).toBe('no_sources')
    expect(result.ok && result.message.citations).toEqual([])
  })

  it.each([
    ['quota: x', { ok: false, code: 'quota' }],
    ['rate: x', { ok: false, code: 'rate_limited', retryAfterSec: 30 }],
    ['forbidden: x', { ok: false, code: 'forbidden' }],
    ['offline: x', { ok: false, code: 'offline' }],
    ['disabled: x', { ok: false, code: 'disabled' }],
  ])('%s -> the error', async (question, expected) => {
    expect(await fake.client.ask(req(question))).toEqual(expected)
  })

  it('any other question gets a plain answer and keeps or starts the conversation', async () => {
    const first = await fake.client.ask(req('hello'))
    expect(first.ok && first.message.citations).toEqual([])
    const again = await fake.client.ask({ ...req('hello'), conversationId: 'conv_keep' })
    expect(again.ok && again.conversationId).toBe('conv_keep')
    expect(first.ok && first.conversationId).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
  })

  it('offers a signed-in context with one workspace', async () => {
    expect(await fake.context()).toEqual({
      workspaces: [{ id: 'ws_fake', name: 'Fake workspace' }],
      currentWorkspaceId: 'ws_fake',
      signedIn: true,
    })
  })
})
