/**
 * G8-02 (UNI-1397): the author of a new threaded comment follows the workbook
 * session the renderer has open — not the tab's open-retry history (BE-5). A
 * Save As swaps the session to the new file, so a bound workbook saved as a
 * local copy authors "User" from then on; the renderer keeps its answer current
 * across session and account changes and drops stale answers (FE-4 / FE-5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
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
