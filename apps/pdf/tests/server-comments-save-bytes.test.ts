/**
 * G8-15 (UNI-1410): card test line "Save adds no annotation (byte compare)".
 * A bound PDF's save payload goes through `withoutFileNoteWrites`; whatever note
 * work the session held (a new note, a reply to the file's note, a rewrite, a
 * deletion), the saved file has exactly the file's own annotations, each one
 * byte-identical to the original object. A local unbound file keeps today's
 * annotation comments (the same payload writes the note).
 */
import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib'
import { applySaveRequest } from '../src/main/save-pdf'
import { withoutFileNoteWrites } from '../src/renderer/server-comments/bound-save'
import type { SavePdfRequest } from '../src/shared/ipc'

const NOTE_RECT: [number, number, number, number] = [100, 682, 120, 700]
const HIGHLIGHT_QUAD = [72, 560, 300, 560, 72, 540, 300, 540]

/** One page with a note from another tool and a highlight, as a reviewer would send it */
async function fixture(): Promise<{ bytes: Uint8Array; noteObj: number }> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const note = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [...NOTE_RECT],
    Name: 'Comment',
    F: 4,
    P: page.ref,
  })
  note.set(PDFName.of('Contents'), PDFHexString.fromText('Original comment'))
  note.set(PDFName.of('T'), PDFHexString.fromText('Reviewer'))
  note.set(PDFName.of('CreationDate'), PDFString.of("D:20260810120000+08'00'"))
  const noteRef = doc.context.register(note)
  const hl = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [72, 540, 300, 560],
    QuadPoints: HIGHLIGHT_QUAD,
    C: [1, 1, 0],
    F: 4,
    P: page.ref,
  })
  const hlRef = doc.context.register(hl)
  page.node.set(PDFName.of('Annots'), doc.context.obj([noteRef, hlRef]))
  return { bytes: await doc.save({ useObjectStreams: false }), noteObj: noteRef.objectNumber }
}

/** What a session that touched the comments would send (the pre-G8-15 path for a bound file too) */
function sessionPayload(noteObj: number): SavePdfRequest {
  return {
    path: 'bound.pdf',
    markups: [],
    formValues: [],
    stamps: [],
    drawings: [
      {
        kind: 'note',
        pageIndex: 0,
        color: [1, 0.78, 0.13],
        at: [200, 500],
        contents: 'New comment',
        author: 'User',
        createdMs: 1786511400000,
      },
      {
        kind: 'note',
        pageIndex: 0,
        color: [1, 0.78, 0.13],
        at: [NOTE_RECT[0], NOTE_RECT[3]],
        contents: 'A reply',
        author: 'User',
        createdMs: 1786511400000,
        replyToSaved: { objNum: noteObj, rect: NOTE_RECT, contents: 'Original comment' },
      },
    ],
    noteEdits: [
      {
        pageIndex: 0,
        objNum: noteObj,
        rect: NOTE_RECT,
        oldContents: 'Original comment',
        contents: 'Rewritten',
      },
    ],
    annotDeletes: [
      {
        pageIndex: 0,
        objNum: noteObj,
        subtype: 'note',
        rect: NOTE_RECT,
        contents: 'Original comment',
      },
    ],
  }
}

/** Every annotation of page 1, as `<Subtype>: <serialized dictionary bytes>` */
async function annotBytes(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(0)
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) return []
  const out: string[] = []
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i)
    const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref
    out.push(String(obj))
  }
  return out.sort()
}

describe('bound PDF save writes no note (G8-15)', () => {
  it('keeps exactly the file own annotations, byte for byte', async () => {
    const { bytes, noteObj } = await fixture()
    const before = await annotBytes(bytes)
    expect(before).toHaveLength(2)
    const request = withoutFileNoteWrites(sessionPayload(noteObj), true)
    const { bytes: out } = await applySaveRequest(bytes, request)
    expect(await annotBytes(out)).toEqual(before)
  })

  it('keeps markup edits: they are document edits, not comments', () => {
    const payload = {
      ...sessionPayload(1),
      annotDeletes: [
        { pageIndex: 0, objNum: 9, subtype: 'highlight' as const, rect: NOTE_RECT },
        { pageIndex: 0, objNum: 1, subtype: 'note' as const, rect: NOTE_RECT },
      ],
    }
    const out = withoutFileNoteWrites(payload, true)
    expect(out.annotDeletes).toEqual([payload.annotDeletes[0]])
    expect(out.drawings).toEqual([])
    expect(out.noteEdits).toEqual([])
  })

  it('a local unbound file keeps today’s annotation comments', async () => {
    const { bytes, noteObj } = await fixture()
    const payload = sessionPayload(noteObj)
    expect(withoutFileNoteWrites(payload, false)).toBe(payload)
    const { bytes: out } = await applySaveRequest(bytes, {
      ...payload,
      noteEdits: [],
      annotDeletes: [],
    })
    const after = await annotBytes(out)
    expect(after.length).toBe(4)
    expect(after.some((a) => a.includes('/Subtype /Text') && a.includes('/IRT'))).toBe(true)
  })
})
