import { describe, expect, it } from 'vitest'
import { newNoteInput } from '../src/renderer/note-threads'

describe('newNoteInput (the open comment box -> pending note)', () => {
  const draft = { origIdx: 2, at: [100, 200] as [number, number] }
  const color: [number, number, number] = [1, 0.8, 0]

  it('builds the pending note from the typed text, trimmed', () => {
    expect(newNoteInput(draft, '  check this  ', color, 'Ann', 1234)).toEqual({
      kind: 'note',
      pageIndex: 2,
      color,
      at: [100, 200],
      contents: 'check this',
      author: 'Ann',
      createdMs: 1234,
    })
  })

  it('an empty or blank box is not a note', () => {
    expect(newNoteInput(draft, '', color, 'Ann', 1)).toBeNull()
    expect(newNoteInput(draft, '  \n ', color, 'Ann', 1)).toBeNull()
  })

  it('no author name leaves the field out of the file', () => {
    expect(newNoteInput(draft, 'x', color, '', 1)?.author).toBeUndefined()
  })
})
