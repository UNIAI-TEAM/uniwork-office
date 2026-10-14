import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@genoffice/agent-core'
import { UniworkConversations } from '../src/uniwork/conversation'
import { UniworkError, uniworkErrorKey } from '../src/uniwork/errors'
import { streamUniwork, type UniworkTurnRequest } from '../src/uniwork/protocol'
import { UNIWORK_QUESTION_MAX_RUNES } from '../src/uniwork/slice'
import type { UniworkScope } from '../src/uniwork/types'
import {
  FACADE_QUESTION_MAX_RUNES,
  createUniworkFake,
  error,
  oneChunk,
  recorder,
} from './fixtures/uniwork-fake'

/**
 * The façade takes a question as one string of at most 8000 runes and never
 * an image part (openai_facade.go UniworkQuestionMaxRunes, `Content string`).
 * The panels build "instruction + editor context", which is often longer: the
 * adapter keeps the instruction whole and clips the context to fit.
 */

const scope: UniworkScope = { kind: 'org', orgId: 'org-1', format: 'docx' }

function turn(messages: AgentMessage[]): UniworkTurnRequest {
  return { scope, messages, tools: [], toolPolicy: { cloudTools: false } }
}

const runes = (s: string) => [...s].length

/** a panel message: the user's words, then the editor context the loop appends */
function panelQuestion(instruction: string, context: string): AgentMessage {
  return { role: 'user', text: `${instruction}\n\n${context}`, instruction }
}

describe('UniWork AI question cap (façade 8000 runes, string content)', () => {
  it('the cap matches the façade', () => {
    expect(UNIWORK_QUESTION_MAX_RUNES).toBe(FACADE_QUESTION_MAX_RUNES)
  })

  it('a 9000-rune question is clipped on a rune boundary: the instruction stays whole, never a 400', async () => {
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('Done.'))
    const rec = recorder()
    const instruction = 'Tóm tắt tài liệu này'
    // astral characters: a UTF-16 slice would split a surrogate pair
    const context = '😀'.repeat(9000)
    await streamUniwork(fake, turn([panelQuestion(instruction, context)]), rec.cb, {
      conversations: new UniworkConversations(),
    })
    expect(fake.requests).toHaveLength(1)
    const sent = fake.requests[0]!.body.messages[0]!.content as string
    expect(typeof sent).toBe('string')
    expect(runes(sent)).toBeLessThanOrEqual(8000)
    expect(sent.startsWith(`${instruction}\n\n`)).toBe(true)
    expect(sent).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(sent).toMatch(/clipped/i)
    expect(rec.state.text).toBe('Done.')
  })

  it('a question that fits is sent unchanged', async () => {
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('ok'))
    const msg = panelQuestion('fix the typo', 'x'.repeat(7000))
    await streamUniwork(fake, turn([msg]), recorder().cb, {
      conversations: new UniworkConversations(),
    })
    expect(fake.requests[0]!.body.messages[0]!.content).toBe((msg as { text: string }).text)
  })

  it('an instruction over 8000 runes alone is refused before any request with its own message', async () => {
    const fake = createUniworkFake()
    const rec = recorder()
    const err = await streamUniwork(fake, turn([panelQuestion('a'.repeat(8001), 'ctx')]), rec.cb, {
      conversations: new UniworkConversations(),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UniworkError)
    expect((err as UniworkError).code).toBe('question_too_long')
    expect(uniworkErrorKey('question_too_long')).toBe('aiErrQuestionTooLong')
    expect(fake.requests).toHaveLength(0)
  })

  it('a long message without a separate instruction is the user’s own text: refused, not clipped', async () => {
    const fake = createUniworkFake()
    const err = await streamUniwork(
      fake,
      turn([{ role: 'user', text: 'b'.repeat(8001) }]),
      recorder().cb,
      { conversations: new UniworkConversations() },
    ).catch((e: unknown) => e)
    expect((err as UniworkError).code).toBe('question_too_long')
    expect(fake.requests).toHaveLength(0)
  })

  it('image parts are never sent: string content plus an images-not-sent notice', async () => {
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('I can read the text only.'))
    const rec = recorder()
    await streamUniwork(
      fake,
      turn([
        {
          role: 'user',
          text: 'what is this',
          images: [{ mime: 'image/png', base64: 'AAAA' }],
        },
      ]),
      rec.cb,
      { conversations: new UniworkConversations() },
    )
    const body = fake.requests[0]!.body
    expect(body.messages[0]!.content).toBe('what is this')
    expect(JSON.stringify(body)).not.toMatch(/image_url|base64/)
    expect(rec.state.notices).toContainEqual({ kind: 'images-not-sent' })
  })

  it('a 400 invalid_request on a question has its own message, not "unavailable"', async () => {
    const fake = createUniworkFake()
    fake.enqueue(error(400, 'invalid_request'))
    const err = await streamUniwork(fake, turn([{ role: 'user', text: 'hi' }]), recorder().cb, {
      conversations: new UniworkConversations(),
    }).catch((e: unknown) => e)
    expect((err as UniworkError).code).toBe('question_rejected')
    expect(uniworkErrorKey('question_rejected')).toBe('aiErrQuestionRejected')
    expect(uniworkErrorKey('question_rejected', 'web')).toBe('aiErrQuestionRejected')
    // the panel re-sends nothing: one request only
    expect(fake.requests).toHaveLength(1)
  })

  it('the fake façade refuses what the real one refuses', async () => {
    const fake = createUniworkFake()
    const answer = await fake.post({
      scope,
      headers: {},
      body: JSON.stringify({ messages: [{ role: 'user', content: 'c'.repeat(8001) }] }),
      signal: new AbortController().signal,
    })
    expect(answer.status).toBe(400)
    const arrayContent = await fake.post({
      scope,
      headers: {},
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      }),
      signal: new AbortController().signal,
    })
    expect(arrayContent.status).toBe(400)
  })
})
