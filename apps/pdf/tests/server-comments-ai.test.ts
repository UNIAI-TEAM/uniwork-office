/**
 * G8-15 (UNI-1410), invariant 7 on a bound PDF: the AI note tools never write a
 * note into the file and never send a comment. add_note only drafts into the
 * panel composer; reply/edit/delete_note refuse (the file's notes are read-only).
 * A local file keeps today's tools.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { executePdfTool, type PdfAiDeps } from '../src/renderer/ai/tools'
import type { SearchIndex } from '../src/renderer/search'
import type { NoteThreadItem } from '../src/renderer/note-threads'

const INDEX: SearchIndex = [
  {
    text: 'Hello World',
    lower: 'hello world',
    items: [{ start: 0, end: 11, x: 0, y: 700, w: 110, h: 12 }],
  },
]

const FILE_NOTE: NoteThreadItem = {
  key: 'S12',
  saved: null,
  pendingId: null,
  author: 'Reviewer',
  contents: 'Original comment',
  timeMs: null,
  color: null,
  at: [100, 700],
  replies: [],
}

function deps(over: Partial<PdfAiDeps>): PdfAiDeps {
  return {
    doc: () =>
      ({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
      }) as unknown as PDFDocumentProxy,
    fileName: () => 'bound.pdf',
    pageCount: () => 1,
    currentPage: () => 1,
    readOnly: () => false,
    isDeleted: () => false,
    pageOrder: () => [0],
    pageGeom: () => ({ pw: 600, ph: 800, rot: 0 }),
    searchIndex: () => Promise.resolve(INDEX),
    gotoPage: vi.fn(() => true),
    addNote: vi.fn(() => ({ key: 'Pn1' })),
    findNoteRoot: vi.fn(async () => FILE_NOTE),
    replyToThread: vi.fn(),
    editNote: vi.fn(),
    deleteNoteThread: vi.fn(),
    annotationsOn: vi.fn(async () => ({ threads: [FILE_NOTE], markups: [] })),
    ...over,
  } as unknown as PdfAiDeps
}

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input })

describe('AI note tools on a bound PDF', () => {
  it('add_note drafts into the composer and writes nothing', async () => {
    const draftServerComment = vi.fn(() => true)
    const d = deps({ serverComments: () => true, draftServerComment })
    const result = await executePdfTool(
      d,
      call('add_note', { page: 1, text: 'Check spelling', anchor_text: 'World' }),
    )
    expect(result.isError).toBeUndefined()
    expect(result.mutated).toBeUndefined()
    expect(draftServerComment).toHaveBeenCalledWith(0, [110, 712], 'Check spelling')
    expect(d.addNote).not.toHaveBeenCalled()
    expect(result.output).toContain('not posted')
  })

  it('add_note reports when the panel cannot take a draft', async () => {
    const d = deps({ serverComments: () => true, draftServerComment: () => false })
    const result = await executePdfTool(
      d,
      call('add_note', { page: 1, text: 'x', anchor_text: 'World' }),
    )
    expect(result.isError).toBe(true)
    expect(d.addNote).not.toHaveBeenCalled()
  })

  it.each([
    ['reply_note', { page: 1, note_id: 'S12', text: 'Agreed' }],
    ['edit_note', { page: 1, note_id: 'S12', text: 'Rewritten' }],
    ['delete_note', { page: 1, note_id: 'S12' }],
  ])('%s refuses: the file notes are read-only', async (name, input) => {
    const d = deps({ serverComments: () => true, draftServerComment: vi.fn(() => true) })
    const result = await executePdfTool(d, call(name, input))
    expect(result.isError).toBe(true)
    expect(result.output).toContain('read-only')
    expect(d.replyToThread).not.toHaveBeenCalled()
    expect(d.editNote).not.toHaveBeenCalled()
    expect(d.deleteNoteThread).not.toHaveBeenCalled()
  })

  it('a local file keeps today’s add_note (a pending file note)', async () => {
    const d = deps({ serverComments: () => false })
    const result = await executePdfTool(
      d,
      call('add_note', { page: 1, text: 'Check spelling', anchor_text: 'World' }),
    )
    expect(result.mutated).toBe(true)
    expect(d.addNote).toHaveBeenCalledWith(0, [110, 712], 'Check spelling', undefined)
  })
})
