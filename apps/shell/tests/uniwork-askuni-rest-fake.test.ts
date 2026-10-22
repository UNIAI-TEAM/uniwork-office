import { describe, expect, it } from 'vitest'
import { createFakeAskUniRest, createFakeAskUniStore } from '../src/main/uniwork-askuni/rest-fake'
import { createFakeAskUniStream } from '../src/main/uniwork-askuni/stream-fake'
import type { AskUniStreamPayload } from '../src/main/uniwork-askuni/stream-client'
import type { AskUniStreamRequest } from '../src/shared/askuni-api'

/**
 * UNI-2076 s2: the Ask UNI v2 REST fake (UNIWORK_ASKUNI_FAKE=1, unpackaged
 * only): in-memory conversations the streaming fake writes to, capabilities
 * and the picker fixtures.
 */

const WS = 'ws_fake'

function setup() {
  const store = createFakeAskUniStore()
  const stream = createFakeAskUniStream({ delayMs: 0, store })
  const { rest, lookup } = createFakeAskUniRest(store)
  const ask = async (question: string, conversationId?: string) => {
    const events: AskUniStreamPayload[] = []
    const req: AskUniStreamRequest = {
      workspaceId: WS,
      question,
      locale: 'en',
      ...(conversationId ? { conversationId } : {}),
    }
    const terminal = await stream.stream(req, {
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })
    const run = events.find((e) => e.type === 'run') as { conversationId: string } | undefined
    return { terminal, conversationId: run?.conversationId ?? '' }
  }
  return { rest, lookup, ask }
}

describe('fake history', () => {
  it('a fake answer shows up in the conversation list and its messages', async () => {
    const { rest, ask } = setup()
    expect(await rest.conversations(WS)).toEqual({ ok: true, conversations: [] })
    const first = await ask('docs: what is the budget?')
    expect(first.terminal.type).toBe('done')
    const list = await rest.conversations(WS)
    expect(list.ok && list.conversations).toEqual([
      expect.objectContaining({ id: first.conversationId, title: 'docs: what is the budget?' }),
    ])
    const messages = await rest.messages(first.conversationId)
    expect(messages.ok && messages.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages.ok && messages.messages[1].citations.length).toBeGreaterThan(0)
  })

  it('a follow-up appends to the same conversation; a new question opens another', async () => {
    const { rest, ask } = setup()
    const first = await ask('hello')
    await ask('and then?', first.conversationId)
    const second = await ask('another topic')
    expect(second.conversationId).not.toBe(first.conversationId)
    const messages = await rest.messages(first.conversationId)
    expect(messages.ok && messages.messages).toHaveLength(4)
    const list = await rest.conversations(WS)
    // newest first
    expect(list.ok && list.conversations.map((c) => c.id)).toEqual([
      second.conversationId,
      first.conversationId,
    ])
  })

  it('a failed or dropped answer stores nothing', async () => {
    const { rest, ask } = setup()
    await ask('quota: x')
    await ask('drop: x')
    expect(await rest.conversations(WS)).toEqual({ ok: true, conversations: [] })
  })

  it('rename, delete and feedback act on the stored conversation', async () => {
    const { rest, ask } = setup()
    const { conversationId } = await ask('hello')
    expect(await rest.rename(conversationId, 'Renamed')).toEqual({ ok: true })
    const list = await rest.conversations(WS)
    expect(list.ok && list.conversations[0].title).toBe('Renamed')
    const messages = await rest.messages(conversationId)
    const answerId = messages.ok ? messages.messages[1].id : ''
    expect(await rest.feedbackSet({ conversationId, messageId: answerId, rating: 'up' })).toEqual({
      ok: true,
    })
    expect(await rest.feedbackClear(conversationId, answerId)).toEqual({ ok: true })
    expect(await rest.feedbackClear(conversationId, 'nope')).toEqual({ ok: false, error: 'error' })
    expect(await rest.remove(conversationId)).toEqual({ ok: true })
    expect(await rest.messages(conversationId)).toEqual({ ok: false, error: 'error' })
    expect(await rest.conversations(WS)).toEqual({ ok: true, conversations: [] })
  })
})

describe('fake capabilities and lookup', () => {
  it('offers Auto + haiku + sonnet, opus disabled', async () => {
    const { rest } = setup()
    const caps = await rest.capabilities(WS)
    expect(caps).toMatchObject({ ok: true, enabled: true, autoModel: 'sonnet' })
    expect(caps.ok && caps.models.map((m) => [m.key, m.enabled])).toEqual([
      ['haiku', true],
      ['sonnet', true],
      ['opus', false],
    ])
  })

  it.each(['task', 'meeting', 'document', 'project', 'member', 'room'] as const)(
    'has %s fixtures',
    async (kind) => {
      const { lookup } = setup()
      const result = await lookup.lookup({ workspaceId: WS, kind, query: '' })
      expect(result.ok && result.items.length).toBeGreaterThan(0)
      expect(result.ok && result.items.every((i) => i.kind === kind)).toBe(true)
    },
  )

  it('filters without accents and returns at most 20', async () => {
    const { lookup } = setup()
    const members = await lookup.lookup({ workspaceId: WS, kind: 'member', query: 'nguyen' })
    expect(members.ok && members.items.length).toBeGreaterThan(0)
    expect(members.ok && members.items.every((i) => i.title.includes('Nguyễn'))).toBe(true)
    const tasks = await lookup.lookup({ workspaceId: WS, kind: 'task', query: '' })
    expect(tasks.ok && tasks.items.length).toBeLessThanOrEqual(20)
  })
})
