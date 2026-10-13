// @vitest-environment jsdom
/**
 * G8-02 (UNI-1397), BE-6 / FE-1: a thread written by the neutral author keeps
 * the fixed "User" (and its one personId) in the file; the pane shows it in the
 * UI language. Any other author verbatim.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { personIdFor } from '@genoffice/xlsx-gateway/gateway/xlsx-threaded-comments'
import { ThreadHoverCard } from '../src/renderer/ThreadedCommentsPane'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { displayCommentAuthor } from '../src/renderer/comment-author'
import { FALLBACK_AUTHOR, ThreadStore, type CellThread } from '../src/renderer/threaded-comments'

Object.assign(window, { desktopApi: { onLanguageChanged: () => () => undefined } })

const thread = (author: string, replyAuthors: readonly string[] = []): CellThread => ({
  row: 0,
  column: 0,
  id: 't1',
  personId: personIdFor(author),
  author,
  dT: '2026-10-13T08:00:00Z',
  done: false,
  text: 'hello',
  replies: replyAuthors.map((name, i) => ({
    id: `r${i}`,
    personId: personIdFor(name),
    author: name,
    dT: '2026-10-13T09:00:00Z',
    text: 'reply',
  })),
})

/** every author label the hover card shows: the root first, then the replies */
function authorsShown(
  lang: 'vi' | 'en',
  author: string,
  replyAuthors: readonly string[] = [],
): (string | null)[] {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(LocaleProvider, {
        initial: lang,
        children: createElement(ThreadHoverCard, {
          hover: { sheetId: 's1', thread: thread(author, replyAuthors), clientX: 0, clientY: 0 },
        }),
      }),
    ),
  )
  const names = [...container.querySelectorAll('.tc-author')].map((el) => el.textContent)
  act(() => root.unmount())
  container.remove()
  return names
}

const authorShown = (lang: 'vi' | 'en', author: string) => authorsShown(lang, author)[0]

describe('sheets threaded comments: the neutral author label', () => {
  it('vi shows "Người dùng" for the stored "User"; en shows "User"; names stay verbatim', () => {
    expect(authorShown('vi', FALLBACK_AUTHOR)).toBe('Người dùng')
    expect(authorShown('en', FALLBACK_AUTHOR)).toBe('User')
    expect(authorShown('vi', 'Nguyễn An')).toBe('Nguyễn An')
  })

  it('the hover card maps a reply by the neutral author the same way (BE-9)', () => {
    expect(authorsShown('vi', 'Nguyễn An', [FALLBACK_AUTHOR, 'Trần Bình'])).toEqual([
      'Nguyễn An',
      'Người dùng',
      'Trần Bình',
    ])
    expect(authorsShown('en', FALLBACK_AUTHOR, [FALLBACK_AUTHOR])).toEqual(['User', 'User'])
  })

  it('a locale change never creates a new person: the stored author stays "User"', () => {
    const store = new ThreadStore()
    store.setAuthor('')
    expect(store.authorName()).toBe('User')
    expect(personIdFor(store.authorName())).toBe(personIdFor('User'))
    expect(displayCommentAuthor('User', 'Người dùng')).toBe('Người dùng')
  })
})
