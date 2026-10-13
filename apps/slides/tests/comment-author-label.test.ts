/**
 * G8-02 (UNI-1397), BE-6 / FE-1: the desktop host writes the neutral author as
 * the fixed "User" into commentAuthors.xml (locale-independent, one person);
 * the comments pane shows it in the UI language. Any other author verbatim.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { SlideComment } from '../src/shared/ipc'
import { CommentsPane } from '../src/renderer/components/CommentsPane'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { NEUTRAL_COMMENT_AUTHOR, displayCommentAuthor } from '../src/renderer/comment-author'
import { NEUTRAL_COMMENT_AUTHOR as HOST_NEUTRAL_AUTHOR } from '../src/main/uniwork-policy'

Object.assign(window, { slidesApi: { onLanguageChanged: () => () => undefined } })

const comment = (authorId: number, author: string, initials: string): SlideComment => ({
  authorId,
  author,
  initials,
  dt: '2026-10-13T08:00:00Z',
  idx: 1,
  text: `by ${author}`,
})

function authorsShown(lang: 'vi' | 'en', comments: SlideComment[]): (string | null)[] {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const noop = () => undefined
  act(() =>
    root.render(
      createElement(LocaleProvider, {
        initial: lang,
        children: createElement(CommentsPane, {
          slideIndex: 0,
          comments,
          onAdd: noop,
          onDelete: noop,
          onCollapse: noop,
        }),
      }),
    ),
  )
  const names = [...container.querySelectorAll('.comment-author')].map((el) => el.textContent)
  act(() => root.unmount())
  container.remove()
  return names
}

describe('slides comments pane: the neutral author label', () => {
  it('the renderer constant is the value the host writes', () => {
    expect(NEUTRAL_COMMENT_AUTHOR).toBe(HOST_NEUTRAL_AUTHOR)
  })

  it('vi shows "Người dùng" for the stored "User"; en shows "User"; names stay verbatim', () => {
    const comments = [comment(0, 'User', 'U'), comment(1, 'Nguyễn An', 'NA')]
    expect(authorsShown('vi', comments)).toEqual(['Người dùng', 'Nguyễn An'])
    expect(authorsShown('en', comments)).toEqual(['User', 'Nguyễn An'])
    // display only: the comment model keeps the file value
    expect(comments[0]!.author).toBe('User')
  })

  it('only the exact constant maps', () => {
    expect(displayCommentAuthor('User', 'Người dùng')).toBe('Người dùng')
    expect(displayCommentAuthor('user', 'Người dùng')).toBe('user')
    expect(displayCommentAuthor('Người dùng', 'Người dùng')).toBe('Người dùng')
  })
})
