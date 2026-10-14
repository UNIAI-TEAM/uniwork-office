import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@genoffice/agent-core'
import { sliceUniworkTurn } from '../src/uniwork/slice'

const history: AgentMessage[] = [
  { role: 'user', text: 'first question' },
  { role: 'assistant', text: 'first answer' },
  { role: 'user', text: 'make the title bold' },
  {
    role: 'assistant',
    text: 'On it.',
    toolCalls: [
      { id: 'call-a', name: 'format_text', input: { bold: true } },
      { id: 'call-b', name: 'read_document', input: {} },
    ],
  },
  {
    role: 'tool',
    results: [
      { id: 'call-a', name: 'format_text', output: 'ok' },
      { id: 'call-b', name: 'read_document', output: 'no such range', isError: true },
    ],
  },
]

describe('sliceUniworkTurn', () => {
  it('question turn sends exactly one user message', () => {
    const slice = sliceUniworkTurn([...history.slice(0, 2), { role: 'user', text: 'second question' }])
    expect(slice.kind).toBe('question')
    expect(slice.messages).toEqual([{ role: 'user', content: 'second question' }])
  })

  it('question turn with images sends content parts', () => {
    const slice = sliceUniworkTurn([
      { role: 'user', text: 'what is this', images: [{ mime: 'image/png', base64: 'AAAA' }] },
    ])
    expect(slice.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
    ])
  })

  it('tool-result turn sends only the trailing tool results', () => {
    const slice = sliceUniworkTurn(history)
    expect(slice.kind).toBe('tool-result')
    expect(slice.messages).toEqual([
      { role: 'tool', tool_call_id: 'call-a', content: 'ok' },
      { role: 'tool', tool_call_id: 'call-b', content: 'Error: no such range' },
    ])
    expect(JSON.stringify(slice.messages)).not.toMatch(/assistant|system|first question|make the title bold/)
  })

  it('refuses a history that ends with an assistant turn or is empty', () => {
    expect(() => sliceUniworkTurn([])).toThrow()
    expect(() => sliceUniworkTurn(history.slice(0, 2))).toThrow()
  })
})
