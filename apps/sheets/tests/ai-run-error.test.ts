// A failed AI run is shown once, in the chat (visual round 2, R2-02: the same error used to sit
// in the panel, the ribbon row, a toast and the status bar).
import { describe, expect, it } from 'vitest'

import type { AiChatMessage } from '../src/renderer/ai/AiChatPanel'
import { markRunFailed } from '../src/renderer/ai/run-error'

const user = (text: string): AiChatMessage => ({ role: 'user', text, tools: [] })

describe('markRunFailed', () => {
  it('marks the last user message undelivered and puts the error in the assistant bubble', () => {
    const chat: AiChatMessage[] = [
      user('first'),
      { role: 'assistant', text: 'ok', tools: [] },
      user('second'),
      {
        role: 'assistant',
        text: '',
        streaming: true,
        tools: [{ id: 'a', name: 'x', running: true } as never, { id: 'b', name: 'y' } as never],
      },
    ]
    const next = markRunFailed(chat, 'No key. Add one in AI settings.')
    expect(next[0]).toEqual(chat[0])
    expect(next[2]).toMatchObject({ role: 'user', undelivered: true })
    expect(next[3]).toMatchObject({
      role: 'assistant',
      text: 'No key. Add one in AI settings.',
      isError: true,
      streaming: false,
    })
    expect(next[3]!.tools).toHaveLength(1)
    // the input is not mutated
    expect(chat[2]).not.toHaveProperty('undelivered')
  })

  it('keeps a chat without an assistant bubble intact', () => {
    expect(markRunFailed([user('hi')], 'x')).toEqual([{ ...user('hi'), undelivered: true }])
  })
})
