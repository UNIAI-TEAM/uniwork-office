/**
 * G8-02 (UNI-1397): the author of a new threaded comment follows the workbook
 * session the renderer has open — not the tab's open-retry history (BE-5). A
 * Save As swaps the session to the new file, so a bound workbook saved as a
 * local copy authors "User" from then on; the renderer keeps its answer current
 * across session and account changes and drops stale answers (FE-4 / FE-5).
 */
import { userInfo } from 'node:os'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCellEditsToXlsx } from '@genoffice/xlsx-gateway/gateway/xlsx-gateway'
import { personIdFor } from '@genoffice/xlsx-gateway/gateway/xlsx-threaded-comments'
import { sessionDocumentPath, workbookCommentAuthor } from '../src/main/comment-author'
import { setUniworkDocumentPolicy } from '../src/main/uniwork-policy'
import { followCommentAuthor } from '../src/renderer/comment-author'
import { FALLBACK_AUTHOR, ThreadStore } from '../src/renderer/threaded-comments'

const BOUND = 'C:/u/uniwork-documents/dep/acc/doc1/Budget.xlsx'
const LOCAL = 'C:/Users/me/Documents/Budget copy.xlsx'
const NAME = 'Nguyễn An'

let signedIn: string | null = NAME
function installShellPolicy(): void {
  // the shell's resolver: bound + signed in = the display name, else "User"
  setUniworkDocumentPolicy({
    isBound: (p) => p === BOUND,
    isReadOnly: () => false,
    commentAuthor: (p) => (p === BOUND && signedIn ? signedIn : 'User'),
  })
}

afterEach(() => {
  setUniworkDocumentPolicy(null)
  signedIn = NAME
})

describe('workbookCommentAuthor (main, user:display-name)', () => {
  it('answers for the session the renderer names, through a Save As to a local file', () => {
    installShellPolicy()
    const sessions = new Map([['s1', { path: BOUND }]])
    expect(workbookCommentAuthor(sessions, 's1')).toBe(NAME)

    // Save As: main deletes the old session and opens a new one on the target
    sessions.delete('s1')
    sessions.set('s2', { path: LOCAL })
    expect(workbookCommentAuthor(sessions, 's2')).toBe('User')
    // a stale id (the renderer has not re-asked yet) never answers the old name
    expect(workbookCommentAuthor(sessions, 's1')).toBe('User')
  })

  it('a CSV session and a restored recovery copy answer for the file the user knows', () => {
    installShellPolicy()
    const sessions = new Map([
      ['csv', { path: 'C:/tmp/import/Budget.xlsx', csvSourcePath: BOUND }],
      ['restored', { path: 'C:/tmp/recovery/x.xlsx', restoreTarget: BOUND }],
      ['unsaved', { path: 'C:/tmp/new/Book1.xlsx', suggestSaveAs: BOUND }],
    ])
    expect(workbookCommentAuthor(sessions, 'csv')).toBe(NAME)
    expect(workbookCommentAuthor(sessions, 'restored')).toBe(NAME)
    // an unsaved new workbook / converted import has no file yet
    expect(sessionDocumentPath(sessions.get('unsaved')!)).toBeNull()
    expect(workbookCommentAuthor(sessions, 'unsaved')).toBe('User')
  })

  it('signed out, no session id, or no shell policy answers "User"', () => {
    installShellPolicy()
    const sessions = new Map([['s1', { path: BOUND }]])
    expect(workbookCommentAuthor(sessions, undefined)).toBe('User')
    expect(workbookCommentAuthor(sessions, 42)).toBe('User')
    signedIn = null
    expect(workbookCommentAuthor(sessions, 's1')).toBe('User')
    setUniworkDocumentPolicy(null)
    signedIn = NAME
    expect(workbookCommentAuthor(sessions, 's1')).toBe('User')
  })
})

describe('the renderer keeps the thread author current', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('a late answer for the previous session never overwrites the current one (FE-5)', async () => {
    const store = new ThreadStore()
    let answerOld: (name: string) => void = () => undefined
    // the previous session's request is still in flight when the next opens
    const disposeOld = followCommentAuthor(
      () => new Promise<string>((resolve) => (answerOld = resolve)),
      undefined,
      (name) => store.setAuthor(name),
    )
    disposeOld()
    followCommentAuthor(
      async () => 'User',
      undefined,
      (name) => store.setAuthor(name),
    )
    await flush()
    answerOld(NAME)
    await flush()
    expect(store.authorName()).toBe('User')
  })

  it('sign-in while the workbook stays open re-asks; the neutral author is one fixed person', async () => {
    const store = new ThreadStore()
    let answer = 'User'
    let ping: () => void = () => undefined
    const onChanged = vi.fn((handler: () => void) => {
      ping = handler
      return () => undefined
    })
    followCommentAuthor(
      async () => answer,
      onChanged,
      (name) => store.setAuthor(name),
    )
    await flush()
    expect(store.authorName()).toBe(FALLBACK_AUTHOR)
    expect(personIdFor(store.authorName())).toBe(personIdFor('User'))
    answer = NAME
    ping()
    await flush()
    expect(store.authorName()).toBe(NAME)
  })
})

describe('the renderer never keeps the previous author while it re-asks (BE-8)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('a thread added before the new session answers is "User"', async () => {
    installShellPolicy()
    const sessions = new Map([
      ['s1', { path: BOUND }],
      ['s2', { path: LOCAL }],
    ])
    const store = new ThreadStore()
    const disposeBound = followCommentAuthor(
      async () => workbookCommentAuthor(sessions, 's1'),
      undefined,
      (name) => store.setAuthor(name),
    )
    await flush()
    expect(store.authorName()).toBe(NAME)

    // Save As to a local copy: the answer for s2 is still in flight
    disposeBound()
    let answer: (name: string) => void = () => undefined
    followCommentAuthor(
      () => new Promise<string>((resolve) => (answer = resolve)),
      undefined,
      (name) => store.setAuthor(name),
    )
    const thread = store.add('sheet-1', 0, 0, 'written during the ask')
    expect(thread.author).toBe('User')
    expect(thread.personId).toBe(personIdFor('User'))
    answer(workbookCommentAuthor(sessions, 's2'))
    await flush()
    expect(store.authorName()).toBe('User')
  })
})

/** a one-sheet workbook package, as the streamed save path reads it */
async function blankWorkbook(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1"/><sheetData/></worksheet>',
  )
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** the store's threads saved the way univer-sync hands them over, then read back */
async function savedParts(store: ThreadStore): Promise<{ threads: string; persons: string }> {
  const notes = store.sheetThreads('sheet-1').map((thread) => {
    const { row, column, text, ...rest } = thread
    return { row, column, author: thread.author, text, thread: { ...rest } }
  })
  const saved = await applyCellEditsToXlsx(
    await blankWorkbook(),
    [],
    [],
    [],
    undefined,
    [],
    [],
    [],
    [],
    [],
    null,
    [],
    [{ sheetName: 'Data', notes }],
  )
  const zip = await JSZip.loadAsync(saved.buffer)
  const threadPart = Object.keys(zip.files).find((p) => p.startsWith('xl/threadedComments/'))
  return {
    threads: await zip.file(threadPart!)!.async('string'),
    persons: await zip.file('xl/persons/person.xml')!.async('string'),
  }
}

describe('the saved workbook carries the resolved author (BE-7 readback)', () => {
  it('a local workbook saves threads and replies as the one person "User", never the OS account', async () => {
    installShellPolicy()
    const sessions = new Map([['s2', { path: LOCAL }]])
    const store = new ThreadStore()
    store.setAuthor(workbookCommentAuthor(sessions, 's2'))
    store.add('sheet-1', 0, 0, 'root')
    store.reply('sheet-1', 0, 0, 'reply')
    store.add('sheet-1', 1, 1, 'second root')

    const { threads, persons } = await savedParts(store)
    const neutralId = personIdFor('User')
    expect(threads.match(/personId="([^"]+)"/g)).toEqual([
      `personId="${neutralId}"`,
      `personId="${neutralId}"`,
      `personId="${neutralId}"`,
    ])
    expect(persons.match(/<person [^>]*>/g)).toHaveLength(1)
    expect(persons).toContain('displayName="User"')
    expect(persons).toContain(`id="${neutralId}"`)
    for (const os of [userInfo().username, process.env.USERNAME, process.env.LOGNAME]) {
      if (!os) continue
      expect(threads).not.toContain(os)
      expect(persons).not.toContain(os)
    }
  })

  it('a bound workbook signed in saves the display name as its person', async () => {
    installShellPolicy()
    const sessions = new Map([['s1', { path: BOUND }]])
    const store = new ThreadStore()
    store.setAuthor(workbookCommentAuthor(sessions, 's1'))
    store.add('sheet-1', 0, 0, 'root')

    const { threads, persons } = await savedParts(store)
    expect(threads).toContain(`personId="${personIdFor(NAME)}"`)
    expect(persons).toContain(`displayName="${NAME}"`)
    expect(persons).not.toContain('displayName="User"')
  })
})
