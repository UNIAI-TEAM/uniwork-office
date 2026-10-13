/**
 * G8-02 (UNI-1397): one comment-author source in the shell main process. The
 * shell resolves the author once — a document bound to the signed-in account
 * takes its display name, everything else (local file, signed out, a profile
 * without a name) takes the neutral constant — and hands that source to every
 * editor module through the same seam that carries the bound/read-only policy.
 * Each module helper answers with the source, and falls back to the same
 * neutral constant when no source is installed, the source is blank or the
 * source throws. The OS account name is never a candidate in any of these
 * paths; the repository grep guard (no-os-account-author.test.ts) pins the
 * textual side.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  setUniworkDocumentPolicy as setDocsPolicy,
  uniworkCommentAuthor as docsCommentAuthor,
} from '../../docs/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setPdfPolicy,
  uniworkCommentAuthor as pdfCommentAuthor,
} from '../../pdf/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setSheetsPolicy,
  uniworkCommentAuthor as sheetsCommentAuthor,
} from '../../sheets/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setSlidesPolicy,
  uniworkCommentAuthor as slidesCommentAuthor,
} from '../../slides/src/main/uniwork-policy'

// modules.ts fans the seam out to all six editor mains. Their entry points pull
// Electron and module-level timers, so this test replaces them with recording
// setters: only the forwarding logic under test runs.
const setters = vi.hoisted(() => {
  const policies: unknown[] = []
  const hooks: unknown[] = []
  const recordingMain = () => ({
    setUniworkDocumentPolicy: (policy: unknown) => void policies.push(policy),
  })
  return { policies, hooks, recordingMain }
})

vi.mock('../../docs/src/main/docs-main', () => ({
  ...setters.recordingMain(),
  setDocsUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../sheets/src/main/sheets-main', () => ({
  ...setters.recordingMain(),
  setSheetsUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../slides/src/main/slides-main', () => ({
  ...setters.recordingMain(),
  setSlidesUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../pdf/src/main/pdf-main', () => ({
  ...setters.recordingMain(),
  setPdfUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../markdown/src/main/markdown-main', () => ({
  ...setters.recordingMain(),
  setMarkdownUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../html/src/main/html-main', () => ({
  ...setters.recordingMain(),
  setHtmlUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))

import {
  COMMENT_AUTHOR_CHANGED_CHANNEL,
  NEUTRAL_COMMENT_AUTHOR,
  createCommentAuthorResolver,
  installUniworkModuleSeams,
  watchCommentAuthorChanges,
} from '../src/main/uniwork-docs/modules'

const BOUND = 'C:/u/uniwork-documents/dep/acc/doc1/Plan.docx'
const LOCAL = 'C:/Users/me/Documents/notes.docx'
const NAME = 'Nguyễn An'

type Policy = {
  isBound(path: string): boolean
  isReadOnly(path: string): boolean
  commentAuthor?(path: string): string
}
type SetPolicy = (next: Policy | null) => void
type CommentAuthor = (path: string | null | undefined) => string

const MODULES: Array<[string, SetPolicy, CommentAuthor]> = [
  ['docs', setDocsPolicy, docsCommentAuthor],
  ['sheets', setSheetsPolicy, sheetsCommentAuthor],
  ['slides', setSlidesPolicy, slidesCommentAuthor],
  ['pdf', setPdfPolicy, pdfCommentAuthor],
]

/** what the shell's own documents service hands the seam for the author path */
const seam = {
  isBound: (path: string) => path === BOUND,
  isReadOnly: () => false,
  onUserSave: () => undefined,
  refuseLockedPath: () => false,
}

afterEach(() => {
  for (const [, setPolicy] of MODULES) setPolicy(null)
})

describe('createCommentAuthorResolver (the single source)', () => {
  it('a bound document takes the signed-in account display name', () => {
    const author = createCommentAuthorResolver({
      isBound: (p) => p === BOUND,
      displayName: () => NAME,
    })
    expect(author(BOUND)).toBe(NAME)
  })

  it('local files, signed-out sessions and unnamed profiles take the neutral constant', () => {
    const signedIn = createCommentAuthorResolver({
      isBound: (p) => p === BOUND,
      displayName: () => NAME,
    })
    expect(signedIn(LOCAL)).toBe(NEUTRAL_COMMENT_AUTHOR)

    const signedOut = createCommentAuthorResolver({
      isBound: (p) => p === BOUND,
      displayName: () => null,
    })
    expect(signedOut(BOUND)).toBe(NEUTRAL_COMMENT_AUTHOR)
    expect(signedOut(LOCAL)).toBe(NEUTRAL_COMMENT_AUTHOR)

    const unnamed = createCommentAuthorResolver({ isBound: () => true, displayName: () => '   ' })
    expect(unnamed(BOUND)).toBe(NEUTRAL_COMMENT_AUTHOR)
  })

  it('the neutral constant is the fixed, locale-independent "User"', () => {
    expect(NEUTRAL_COMMENT_AUTHOR).toBe('User')
  })
})

describe('installUniworkModuleSeams forwards the author source', () => {
  it('every module policy asks the source', () => {
    setters.policies.length = 0
    installUniworkModuleSeams(
      seam,
      createCommentAuthorResolver({ isBound: (p) => p === BOUND, displayName: () => NAME }),
    )
    // docs, sheets, slides, pdf, markdown, html
    expect(setters.policies).toHaveLength(6)
    for (const policy of setters.policies) {
      const forwarded = policy as { commentAuthor(path: string): string }
      expect(forwarded.commentAuthor(BOUND)).toBe(NAME)
      expect(forwarded.commentAuthor(LOCAL)).toBe(NEUTRAL_COMMENT_AUTHOR)
    }
  })

  it('no source installs the neutral constant', () => {
    setters.policies.length = 0
    installUniworkModuleSeams(seam)
    // docs, sheets, slides, pdf, markdown, html
    expect(setters.policies).toHaveLength(6)
    for (const policy of setters.policies) {
      const forwarded = policy as { commentAuthor(path: string): string }
      expect(forwarded.commentAuthor(BOUND)).toBe(NEUTRAL_COMMENT_AUTHOR)
      expect(forwarded.commentAuthor(LOCAL)).toBe(NEUTRAL_COMMENT_AUTHOR)
    }
  })

  it('forwards the source verbatim; the module helper owns the blank/throwing fallback', () => {
    setters.policies.length = 0
    installUniworkModuleSeams(seam, () => '   ')
    const forwarded = setters.policies.map(
      (policy) =>
        policy as {
          isBound(path: string): boolean
          isReadOnly(): boolean
          commentAuthor(path: string): string
        },
    )
    expect(forwarded.map((policy) => policy.commentAuthor(BOUND))).toEqual(Array(6).fill('   '))
    // what the shell installed, as each module's own policy: the helper reads
    // the blank as the neutral constant instead of writing whitespace
    for (const [name, setPolicy, author] of MODULES) {
      setPolicy(forwarded[0] as never)
      expect(author(BOUND), name).toBe(NEUTRAL_COMMENT_AUTHOR)
    }
  })
})

describe('the module helper (one per module)', () => {
  it.each(MODULES)(
    '%s: answers with the installed source, otherwise the neutral constant',
    (_name, setPolicy, author) => {
      // no policy at all (standalone app, or the shell before sign-in wiring)
      setPolicy(null)
      expect(author(BOUND)).toBe(NEUTRAL_COMMENT_AUTHOR)
      expect(author(null)).toBe(NEUTRAL_COMMENT_AUTHOR)
      expect(author(undefined)).toBe(NEUTRAL_COMMENT_AUTHOR)

      setPolicy({
        isBound: () => true,
        isReadOnly: () => false,
        commentAuthor: (path) => (path === BOUND ? NAME : NEUTRAL_COMMENT_AUTHOR),
      })
      expect(author(BOUND)).toBe(NAME)
      expect(author(LOCAL)).toBe(NEUTRAL_COMMENT_AUTHOR)

      // the shell's seam always installs commentAuthor; a policy without it
      // (an older shell, a hand-built policy) keeps the neutral constant
      setPolicy({ isBound: () => true, isReadOnly: () => false })
      expect(author(BOUND)).toBe(NEUTRAL_COMMENT_AUTHOR)

      // a blank or throwing source must not mint an author of its own
      setPolicy({ isBound: () => true, isReadOnly: () => false, commentAuthor: () => '   ' })
      expect(author(BOUND)).toBe(NEUTRAL_COMMENT_AUTHOR)
      setPolicy({
        isBound: () => true,
        isReadOnly: () => false,
        commentAuthor: () => {
          throw new Error('boom')
        },
      })
      expect(author(BOUND)).toBe(NEUTRAL_COMMENT_AUTHOR)
    },
  )
})

describe('account changes reach the editors that cache the author (BE-4 / FE-4)', () => {
  function account(initial: string | null) {
    let name = initial
    const listeners = new Set<() => void>()
    return {
      displayName: () => name,
      onStatus: (listener: () => void) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
      push: (next: string | null) => {
        name = next
        for (const listener of listeners) listener()
      },
    }
  }

  it('sign-in, sign-out and automatic session expiry each ping the editors once', () => {
    const acc = account(null)
    const broadcast = vi.fn()
    watchCommentAuthorChanges({ ...acc, broadcast })

    acc.push(NAME) // sign-in
    expect(broadcast).toHaveBeenCalledTimes(1)
    acc.push(null) // session expired: the status push carries loggedIn false
    expect(broadcast).toHaveBeenCalledTimes(2)
    acc.push('Trần Bình') // another account signs in
    expect(broadcast).toHaveBeenCalledTimes(3)
  })

  it('a status push that keeps the same name (token refresh) stays silent', () => {
    const acc = account(NAME)
    const broadcast = vi.fn()
    watchCommentAuthorChanges({ ...acc, broadcast })
    acc.push(NAME)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('unsubscribes', () => {
    const acc = account(null)
    const broadcast = vi.fn()
    watchCommentAuthorChanges({ ...acc, broadcast })()
    acc.push(NAME)
    expect(broadcast).not.toHaveBeenCalled()
  })

  // The shell broadcasts on one channel; the three editors that cache the
  // author must subscribe to exactly that channel in their preload.
  const repo = join(__dirname, '..', '..', '..')
  const source = (rel: string) => readFileSync(join(repo, rel), 'utf8')

  it('the shell wires the watcher to the account status and broadcasts the channel', () => {
    const index = source('apps/shell/src/main/index.ts')
    expect(index).toMatch(
      /watchCommentAuthorChanges\(\{\s*onStatus: onUniworkAccountStatus,\s*displayName: uniworkAccountDisplayName,/,
    )
    expect(index).toContain('wc.send(COMMENT_AUTHOR_CHANGED_CHANNEL)')
  })

  it.each([
    'apps/docs/src/preload/index.ts',
    'apps/pdf/src/preload/index.ts',
    'apps/sheets/src/preload/index.ts',
  ])('%s subscribes to the broadcast channel', (preload) => {
    expect(source(preload)).toContain(`ipcRenderer.on('${COMMENT_AUTHOR_CHANGED_CHANNEL}'`)
  })
})
