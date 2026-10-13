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

const thread = (author: string): CellThread => ({
  row: 0,
  column: 0,
  id: 't1',
  personId: personIdFor(author),
  author,
  dT: '2026-10-13T08:00:00Z',
  done: false,
  text: 'hello',
  replies: [],
})

function authorShown(lang: 'vi' | 'en', author: string): string | null | undefined {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(LocaleProvider, {
        initial: lang,
        children: createElement(ThreadHoverCard, {
          hover: { sheetId: 's1', thread: thread(author), clientX: 0, clientY: 0 },
        }),
      }),
    ),
  )
  const name = container.querySelector('.tc-author')?.textContent
  act(() => root.unmount())
  container.remove()
  return name
}

describe('sheets threaded comments: the neutral author label', () => {
  it('vi shows "Người dùng" for the stored "User"; en shows "User"; names stay verbatim', () => {
    expect(authorShown('vi', FALLBACK_AUTHOR)).toBe('Người dùng')
    expect(authorShown('en', FALLBACK_AUTHOR)).toBe('User')
    expect(authorShown('vi', 'Nguyễn An')).toBe('Nguyễn An')
  })

  it('a locale change never creates a new person: the stored author stays "User"', () => {
    const store = new ThreadStore()
    store.setAuthor('')
    expect(store.authorName()).toBe('User')
    expect(personIdFor(store.authorName())).toBe(personIdFor('User'))
    expect(displayCommentAuthor('User', 'Người dùng')).toBe('Người dùng')
  })
})
