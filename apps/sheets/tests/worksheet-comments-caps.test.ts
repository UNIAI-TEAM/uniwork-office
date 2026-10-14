/**
 * G8-13 tail fix (UNI-1408, BE-d1-3): the preload caps the root comment text and the thread root
 * text at the same 32 767 limit as replies, and rejects longer input with the existing typed error.
 */
import { describe, expect, it } from 'vitest'
import { parseWorksheetComment } from '../src/preload/worksheet-comments'

const MAX = 32_767
const thread = (text: string) => ({
  id: 't1',
  personId: 'p1',
  author: 'Ann',
  dT: '2026-10-13T00:00:00Z',
  done: false,
  text,
  replies: [],
})
const comment = (text: string, threadText = 'root') => ({
  row: 0,
  column: 0,
  author: 'Ann',
  text,
  thread: thread(threadText),
})

describe('worksheet comment text caps', () => {
  it('accepts root comment text and thread root text at the limit', () => {
    const parsed = parseWorksheetComment(comment('a'.repeat(MAX), 'b'.repeat(MAX)))
    expect(parsed.text).toHaveLength(MAX)
    expect(parsed.thread?.text).toHaveLength(MAX)
  })

  it('rejects an over-long root comment text', () => {
    expect(() => parseWorksheetComment(comment('a'.repeat(MAX + 1)))).toThrow(
      'Invalid worksheet comment.',
    )
  })

  it('rejects an over-long thread root text', () => {
    expect(() => parseWorksheetComment(comment('ok', 'b'.repeat(MAX + 1)))).toThrow(
      'Invalid threaded comment.',
    )
  })
})
