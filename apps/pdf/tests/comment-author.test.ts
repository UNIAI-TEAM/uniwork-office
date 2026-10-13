/**
 * G8-02 (UNI-1397): a PDF note carries the author the shell resolves for the
 * file this view shows — the signed-in UniWork display name for a bound file,
 * else the neutral constant "User" — never the OS account name. The real
 * pdf:get-username handler answers per view; the answer is what the note's /T
 * holds after a save. The renderer keeps that answer current across document
 * changes and account changes, dropping stale answers.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown
const { handlers, views } = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  views: { nextId: 1, lastId: 0 },
}))

vi.mock('electron', () => ({
  app: { on: vi.fn(), whenReady: vi.fn(() => new Promise(() => {})) },
  dialog: {},
  shell: {},
  BrowserWindow: class {},
  WebContentsView: class {
    webContents = {
      id: (views.lastId = views.nextId++),
      once: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
    }
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => void handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => void handlers.set(channel, handler)),
    removeHandler: vi.fn(),
  },
}))

import { createPdfView, setUniworkDocumentPolicy } from '../src/main/pdf-main'
import { applySaveRequest } from '../src/main/save-pdf'
import { PDF_CHANNELS, type DrawingInput } from '../src/shared/ipc'
import { NEUTRAL_COMMENT_AUTHOR, followCommentAuthor } from '../src/renderer/comment-author'

const NAME = 'Nguyễn An'
const OS_ACCOUNT = 'ubuntu'

function pdfFile(name: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'pdf-comment-author-')), name)
  writeFileSync(path, '%PDF-1.4\n%%EOF\n')
  return path
}

/** the view that shows `path`, and what its pdf:get-username answers */
function viewOf(path: string): () => Promise<string> {
  createPdfView(path)
  const id = views.lastId
  return async () => String(await handlers.get(PDF_CHANNELS.getUsername)!({ sender: { id } }))
}

/** a new root note plus a reply, authored as the renderer does it, saved and read back */
async function savedAuthors(author: string): Promise<string[]> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  const base = await doc.save({ useObjectStreams: false })
  const note = (contents: string): DrawingInput => ({
    kind: 'note',
    pageIndex: 0,
    color: [1, 0.78, 0.13],
    at: [200, 500],
    contents,
    author,
  })
  const { bytes } = await applySaveRequest(base, {
    path: 'test.pdf',
    markups: [],
    drawings: [note('root'), note('reply')],
    formValues: [],
    stamps: [],
  })
  const saved = await PDFDocument.load(bytes)
  const annots = saved.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  const out: string[] = []
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const ref = annots!.get(i)
    const dict = ref instanceof PDFRef ? saved.context.lookupMaybe(ref, PDFDict) : undefined
    const t = dict?.lookup(PDFName.of('T'))
    if (t instanceof PDFString || t instanceof PDFHexString) out.push(t.decodeText())
  }
  return out
}

afterEach(() => setUniworkDocumentPolicy(null))

describe('pdf:get-username answers for the file this view shows (BE-7)', () => {
  it('bound + signed in = the display name in /T; local file and signed out = "User"', async () => {
    const bound = pdfFile('bound.pdf')
    const local = pdfFile('local.pdf')
    let signedIn: string | null = NAME
    setUniworkDocumentPolicy({
      isBound: (p) => p === bound,
      isReadOnly: () => false,
      commentAuthor: (p) => (p === bound && signedIn ? signedIn : 'User'),
    })
    const boundView = viewOf(bound)
    const localView = viewOf(local)

    expect(await savedAuthors(await boundView())).toEqual([NAME, NAME])
    expect(await savedAuthors(await localView())).toEqual(['User', 'User'])
    // the session expires while the bound file stays open: the next ask is neutral
    signedIn = null
    expect(await savedAuthors(await boundView())).toEqual(['User', 'User'])
  })

  it('a standalone app (no shell policy) answers "User", never the OS account', async () => {
    const answer = await viewOf(pdfFile('plain.pdf'))()
    expect(answer).toBe('User')
    expect(answer).not.toBe(OS_ACCOUNT)
  })
})

describe('followCommentAuthor (renderer; FE-2 / FE-4)', () => {
  function deferred() {
    let resolve: (name: string) => void = () => undefined
    const promise = new Promise<string>((r) => (resolve = r))
    return { promise, resolve }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('asks at once and again on every account-change ping', async () => {
    const answers = ['User', NAME]
    const ask = vi.fn(async () => answers.shift() ?? 'User')
    let ping: () => void = () => undefined
    const onChanged = (handler: () => void) => {
      ping = handler
      return () => undefined
    }
    const apply = vi.fn()
    followCommentAuthor(ask, onChanged, apply)
    await flush()
    expect(apply).toHaveBeenLastCalledWith('User')
    ping() // sign-in while the document stays open
    await flush()
    expect(apply).toHaveBeenLastCalledWith(NAME)
  })

  it('keeps only the latest answer and nothing after dispose (document changed)', async () => {
    const first = deferred()
    const second = deferred()
    const ask = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let ping: () => void = () => undefined
    // the subscription outlives dispose here, to show dispose alone stops answers
    const onChanged = (handler: () => void) => {
      ping = handler
      return () => undefined
    }
    const answers: string[] = []
    const dispose = followCommentAuthor(ask, onChanged, (name) => answers.push(name))
    ping()
    second.resolve(NAME)
    await flush()
    first.resolve('stale') // the stale answer arrives last
    await flush()
    expect(answers.at(-1)).toBe(NAME)
    expect(answers).not.toContain('stale')

    const applied = answers.length
    dispose()
    ping()
    await flush()
    expect(answers).toHaveLength(applied)
  })

  it('a blank or failed answer applies the neutral constant', async () => {
    const blank = vi.fn()
    const failed = vi.fn()
    followCommentAuthor(async () => '  ', undefined, blank)
    followCommentAuthor(() => Promise.reject(new Error('no host')), undefined, failed)
    await flush()
    expect(blank).toHaveBeenLastCalledWith(NEUTRAL_COMMENT_AUTHOR)
    expect(failed).toHaveBeenLastCalledWith(NEUTRAL_COMMENT_AUTHOR)
  })

  it('a note written while the ask is in flight is "User", not the previous name (BE-8)', async () => {
    const bound = pdfFile('bound.pdf')
    const local = pdfFile('local.pdf')
    setUniworkDocumentPolicy({
      isBound: (p) => p === bound,
      isReadOnly: () => false,
      commentAuthor: (p) => (p === bound ? NAME : 'User'),
    })
    let noteAuthor = NEUTRAL_COMMENT_AUTHOR
    const setNoteAuthor = (name: string) => void (noteAuthor = name)
    const disposeBound = followCommentAuthor(viewOf(bound), undefined, setNoteAuthor)
    await flush()
    expect(noteAuthor).toBe(NAME)

    // the user switches to a local file; its answer has not arrived yet
    const pending = deferred()
    disposeBound()
    followCommentAuthor(() => pending.promise, undefined, setNoteAuthor)
    expect(await savedAuthors(noteAuthor)).toEqual(['User', 'User'])

    // the account ping while the same file stays open behaves the same way
    let ping: () => void = () => undefined
    const signedOut = deferred()
    followCommentAuthor(
      vi.fn().mockResolvedValueOnce(NAME).mockReturnValueOnce(signedOut.promise),
      (handler) => ((ping = handler), () => undefined),
      setNoteAuthor,
    )
    await flush()
    expect(noteAuthor).toBe(NAME)
    ping()
    expect(await savedAuthors(noteAuthor)).toEqual(['User', 'User'])
    pending.resolve('User')
    signedOut.resolve('User')
  })
})
