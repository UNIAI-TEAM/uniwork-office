import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@genoffice/agent-core'
import { UniworkConversations } from '../src/uniwork/conversation'
import { UniworkError } from '../src/uniwork/errors'
import { streamUniwork, type UniworkTurnRequest } from '../src/uniwork/protocol'
import type { UniworkScope } from '../src/uniwork/types'
import { createUniworkFake, error, oneChunk, recorder } from './fixtures/uniwork-fake'

const scope: UniworkScope = { kind: 'org', orgId: 'org-1', format: 'docx' }

function question(text: string, before: AgentMessage[] = []): AgentMessage[] {
  return [...before, { role: 'user', text }]
}

const toolRound: AgentMessage[] = [
  { role: 'user', text: 'bold the title' },
  { role: 'assistant', text: '', toolCalls: [{ id: 'srv-call-1', name: 'format_text', input: {} }] },
  { role: 'tool', results: [{ id: 'srv-call-1', name: 'format_text', output: 'ok' }] },
]

function turn(messages: AgentMessage[]): UniworkTurnRequest {
  return { scope, messages, tools: [], toolPolicy: { cloudTools: false } }
}

describe('UniWork AI conversation and run ids', () => {
  it('a follow-up question carries the conversation id and opens a new run', async () => {
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('a1', { ids: { conversation: 'conv-1', run: 'run-1' } }))
    fake.enqueue(oneChunk('a2', { ids: { conversation: 'conv-1', run: 'run-2' } }))
    await streamUniwork(fake, turn(question('q1')), recorder().cb, { conversations })
    await streamUniwork(fake, turn(question('q2')), recorder().cb, { conversations })
    expect(fake.requests[0]!.headers['X-UniWork-AI-Conversation']).toBeUndefined()
    expect(fake.requests[0]!.headers['X-UniWork-AI-Run']).toBeUndefined()
    expect(fake.requests[1]!.headers['X-UniWork-AI-Conversation']).toBe('conv-1')
    expect(fake.requests[1]!.headers['X-UniWork-AI-Run']).toBeUndefined()
  })

  it('conversation_expired drops both ids, emits conversation-restarted, does not resend', async () => {
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('a1', { ids: { conversation: 'conv-old', run: 'run-1' } }))
    fake.enqueue(error(409, 'conversation_expired', { ids: false }))
    fake.enqueue(oneChunk('a3', { ids: { conversation: 'conv-new', run: 'run-9' } }))
    await streamUniwork(fake, turn(question('q1')), recorder().cb, { conversations })

    const second = recorder()
    const err = await streamUniwork(fake, turn(question('q2')), second.cb, { conversations }).catch((e) => e)
    expect(err).toBeInstanceOf(UniworkError)
    expect((err as UniworkError).code).toBe('conversation_expired')
    expect(second.state.notices).toContainEqual({ kind: 'conversation-restarted' })
    expect(fake.requests).toHaveLength(2)

    await streamUniwork(fake, turn(question('q3')), recorder().cb, { conversations })
    expect(fake.requests[2]!.headers['X-UniWork-AI-Conversation']).toBeUndefined()
    expect(fake.requests[2]!.headers['X-UniWork-AI-Run']).toBeUndefined()
    expect(conversations.ids('panel-1')).toEqual({ conversationId: 'conv-new', runId: 'run-9' })
  })

  it('run_expired on a question resends once without the run header', async () => {
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('', { toolCalls: [{ id: 'srv-call-1', name: 'format_text', args: {} }], ids: { conversation: 'conv-1', run: 'run-1' } }))
    // a question inside the run (the loop's wrap-up note after tool results) carries run-1; the server forgot it
    fake.enqueue(error(409, 'run_expired', { ids: { conversation: 'conv-1' } }))
    fake.enqueue(oneChunk('answer', { ids: { conversation: 'conv-1', run: 'run-2' } }))
    await streamUniwork(fake, turn(question('bold the title')), recorder().cb, { conversations })

    const rec = recorder()
    await streamUniwork(fake, turn(question('wrap up', toolRound)), rec.cb, { conversations })
    expect(rec.state.text).toBe('answer')
    expect(fake.requests).toHaveLength(3)
    expect(fake.requests[1]!.headers['X-UniWork-AI-Run']).toBe('run-1')
    expect(fake.requests[2]!.headers['X-UniWork-AI-Run']).toBeUndefined()
    expect(fake.requests[2]!.headers['X-UniWork-AI-Conversation']).toBe('conv-1')
    expect(fake.requests[2]!.body.messages).toEqual([{ role: 'user', content: 'wrap up' }])
  })

  it('run_expired twice on a question gives up after one resend', async () => {
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(error(409, 'run_expired'), error(409, 'run_expired'))
    const err = await streamUniwork(fake, turn(question('q1')), recorder().cb, { conversations }).catch((e) => e)
    expect((err as UniworkError).code).toBe('run_expired')
    expect(fake.requests).toHaveLength(2)
  })

  it('run_expired on a tool-result ends the run (Q-1)', async () => {
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('', { toolCalls: [{ id: 'srv-call-1', name: 'format_text', args: {} }], ids: { conversation: 'conv-1', run: 'run-1' } }))
    fake.enqueue(error(409, 'run_expired', { ids: { conversation: 'conv-1' } }))
    await streamUniwork(fake, turn(question('bold the title')), recorder().cb, { conversations })

    const err = await streamUniwork(fake, turn(toolRound), recorder().cb, { conversations }).catch((e) => e)
    expect(err).toBeInstanceOf(UniworkError)
    expect((err as UniworkError).code).toBe('run_expired')
    // no automatic resend of the original question (lead decision Q-1 a)
    expect(fake.requests).toHaveLength(2)
    expect(conversations.ids('panel-1')).toEqual({ conversationId: 'conv-1' })
  })

  it('a BYOK turn between two UniWork turns starts a new conversation with a boundary notice', async () => {
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('a1', { ids: { conversation: 'conv-1', run: 'run-1' } }))
    fake.enqueue(oneChunk('a3', { ids: { conversation: 'conv-2', run: 'run-3' } }))
    const first = recorder()
    await streamUniwork(fake, turn(question('q1')), first.cb, { conversations })
    expect(first.state.notices).not.toContainEqual(expect.objectContaining({ kind: 'conversation-boundary' }))

    conversations.observe('panel-1', 'openai')

    const third = recorder()
    await streamUniwork(fake, turn(question('q3')), third.cb, { conversations })
    expect(fake.requests[1]!.headers['X-UniWork-AI-Conversation']).toBeUndefined()
    expect(third.state.notices).toContainEqual({ kind: 'conversation-boundary', provider: 'uniwork' })
  })

  it('a first UniWork turn after a BYOK turn is a boundary too', async () => {
    const conversations = new UniworkConversations()
    conversations.observe('panel-1', 'anthropic')
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('a1'))
    const rec = recorder()
    await streamUniwork(fake, turn(question('q1')), rec.cb, { conversations })
    expect(rec.state.notices).toContainEqual({ kind: 'conversation-boundary', provider: 'uniwork' })
  })

  it('another scope (document) starts its own conversation', async () => {
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('a1', { ids: { conversation: 'conv-1', run: 'run-1' } }), oneChunk('a2'))
    await streamUniwork(fake, turn(question('q1')), recorder().cb, { conversations })
    await streamUniwork(
      fake,
      { ...turn(question('q2')), scope: { kind: 'document', documentId: 'doc-9', format: 'docx' } },
      recorder().cb,
      { conversations },
    )
    expect(fake.requests[1]!.headers['X-UniWork-AI-Conversation']).toBeUndefined()
  })

  it('an error answer without id headers keeps the known ids (API §3.7 Q6)', async () => {
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('a1', { ids: { conversation: 'conv-1', run: 'run-1' } }))
    fake.enqueue(error(402, 'credits_exhausted', { ids: false }))
    await streamUniwork(fake, turn(question('q1')), recorder().cb, { conversations })
    await streamUniwork(fake, turn(question('q2')), recorder().cb, { conversations }).catch(() => undefined)
    expect(conversations.ids('panel-1').conversationId).toBe('conv-1')
  })
})
