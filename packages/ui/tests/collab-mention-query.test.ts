import { describe, expect, it } from 'vitest'
import {
  MENTION_DEBOUNCE_MS,
  MENTION_MAX_ROWS,
  buildMentionToken,
  findMentionTrigger,
  insertMention,
} from '../src/collab/mention-query'
import { ULID_A } from './collab-composer-fixtures'

describe('constants', () => {
  it('debounces 150 ms and caps the picker at 20 rows', () => {
    expect(MENTION_DEBOUNCE_MS).toBe(150)
    expect(MENTION_MAX_ROWS).toBe(20)
  })
})

describe('findMentionTrigger', () => {
  it('opens on an @ at the very start', () => {
    expect(findMentionTrigger('@', 1)).toEqual({ start: 0, query: '' })
    expect(findMentionTrigger('@mi', 3)).toEqual({ start: 0, query: 'mi' })
  })

  it('opens on an @ at a word start (after a space or a newline)', () => {
    expect(findMentionTrigger('Nhờ @mi', 7)).toEqual({ start: 4, query: 'mi' })
    expect(findMentionTrigger('line\n@x', 7)).toEqual({ start: 5, query: 'x' })
  })

  it('does not open on an @ inside a word (email address)', () => {
    expect(findMentionTrigger('mail a@b', 8)).toBeNull()
    expect(findMentionTrigger('a@', 2)).toBeNull()
  })

  it('uses the text between the @ and the caret, not what follows the caret', () => {
    expect(findMentionTrigger('@minh anh', 3)).toEqual({ start: 0, query: 'mi' })
  })

  it('closes once whitespace sits between the @ and the caret', () => {
    expect(findMentionTrigger('@mi ', 4)).toBeNull()
    expect(findMentionTrigger('@mi\nx', 5)).toBeNull()
  })

  it('does not open when the caret is before the @', () => {
    expect(findMentionTrigger('hi @mi', 2)).toBeNull()
  })

  it('ignores the @ of an existing mention token (pasted or picked)', () => {
    const token = buildMentionToken(ULID_A, 'Nguyễn An')
    expect(findMentionTrigger(token, token.length)).toBeNull()
    expect(findMentionTrigger(`Xem ${token} `, token.length + 5)).toBeNull()
  })

  it('rejects a second @ inside the query', () => {
    expect(findMentionTrigger('@a@b', 4)).toBeNull()
  })
})

describe('buildMentionToken (stub until body.ts)', () => {
  it('builds [@Label](mention://member/<id>)', () => {
    expect(buildMentionToken(ULID_A, 'Minh Anh')).toBe(`[@Minh Anh](mention://member/${ULID_A})`)
  })

  it('escapes [ ] ( ) in the label with a backslash', () => {
    expect(buildMentionToken(ULID_A, 'Nguyễn [An] (QA)')).toBe(
      `[@Nguyễn \\[An\\] \\(QA\\)](mention://member/${ULID_A})`,
    )
  })

  it('keeps a label on one line', () => {
    expect(buildMentionToken(ULID_A, 'A\nB')).toBe(`[@A B](mention://member/${ULID_A})`)
  })
})

describe('insertMention', () => {
  const token = buildMentionToken(ULID_A, 'Minh Anh')

  it('replaces @query with the token and one space, caret after the space', () => {
    const text = 'Nhờ @mi'
    const trigger = findMentionTrigger(text, text.length)!
    const out = insertMention(text, trigger, text.length, token)
    expect(out.text).toBe(`Nhờ ${token} `)
    expect(out.caret).toBe(out.text.length)
  })

  it('keeps the text after the caret and lands the caret right after the inserted space', () => {
    const text = '@mi tail'
    const trigger = findMentionTrigger(text, 3)!
    const out = insertMention(text, trigger, 3, token)
    expect(out.text).toBe(`${token}  tail`)
    expect(out.caret).toBe(token.length + 1)
  })
})
