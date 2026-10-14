/**
 * G8-13 (UNI-1408), finding F2 of the G8-02 visual round: a reopened workbook with threaded comments
 * showed them as legacy notes, not threads. The sidecar reads `thread` (root, replies, done) from
 * xl/threadedComments; the preload's hand-written validator copied row/column/author/text only, so
 * `thread` vanished between main and renderer and the renderer installed the threads as notes.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseWorksheetComment } from '../src/preload/worksheet-comments'
import { ThreadStore } from '../src/renderer/threaded-comments'

const THREADED = {
  row: 6,
  column: 1,
  author: 'User',
  text: 'Check the total\n\nDone',
  thread: {
    id: '{A1B2C3D4-0000-4000-8000-000000000001}',
    personId: '{9E5A0F3C-0000-4000-8000-000000000002}',
    author: 'User',
    dT: '2026-10-13T09:34:00.00',
    done: true,
    text: 'Check the total',
    replies: [
      {
        id: '{A1B2C3D4-0000-4000-8000-000000000003}',
        personId: '{9E5A0F3C-0000-4000-8000-000000000002}',
        author: 'User',
        dT: '2026-10-13T09:35:00.00',
        text: 'Done',
      },
    ],
  },
}

describe('reopen keeps threaded comments (F2)', () => {
  it('passes the sidecar thread through to the renderer', () => {
    expect(parseWorksheetComment(THREADED)).toEqual(THREADED)
  })

  it('a legacy note stays a note (no thread key)', () => {
    const note = { row: 0, column: 0, author: 'Ann', text: 'plain' }
    const parsed = parseWorksheetComment(note)
    expect(parsed).toEqual(note)
    expect('thread' in parsed).toBe(false)
  })

  it('rejects a malformed thread instead of passing it on', () => {
    expect(() => parseWorksheetComment({ ...THREADED, thread: { id: 1 } })).toThrow()
    expect(() =>
      parseWorksheetComment({
        ...THREADED,
        thread: { ...THREADED.thread, replies: [{ id: 'r', text: 'x' }] },
      }),
    ).toThrow()
  })

  it('the reopened thread lands in the thread store (the pane), not as a note', () => {
    const store = new ThreadStore()
    store.load({
      sheets: [{ id: 'sheet-1', comments: [parseWorksheetComment(THREADED)] }],
    } as never)
    const [thread] = store.sheetThreads('sheet-1')
    expect(thread).toMatchObject({
      row: 6,
      column: 1,
      text: 'Check the total',
      done: true,
      replies: [{ text: 'Done' }],
    })
  })

  it('the preload validator uses the thread-aware parser', () => {
    const source = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
    expect(source).toContain('parseWorksheetComment')
  })
})
