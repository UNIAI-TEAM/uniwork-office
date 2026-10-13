/**
 * G8-02 (UNI-1397), BE-6 / FE-1: a note written by the neutral author keeps the
 * fixed "User" in /T; the margin shows it in the UI language. Any other author
 * verbatim; an empty /T keeps the existing "UniWork Office" fallback.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createI18n, type Lang } from '@genoffice/i18n'
import { describe, expect, it } from 'vitest'
import { NoteMarginColumn } from '../src/renderer/NoteMargin'
import { strings } from '../src/renderer/i18n/strings'
import type { TFunc } from '../src/renderer/i18n/locale'

// the margin measures its cards; jsdom has no ResizeObserver
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const translate = createI18n(strings)
const tFor =
  (lang: Lang): TFunc =>
  (key, params) =>
    translate(lang, key, params)

function draftAuthorShown(lang: Lang, author: string): string | null | undefined {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const noop = () => undefined
  act(() =>
    root.render(
      createElement(NoteMarginColumn, {
        width: 280,
        threads: [],
        draft: { placementKey: 'p1', origIdx: 0, pinX: -20, pinY: 40, color: [1, 0.78, 0.13] },
        activeKey: null,
        author,
        lang,
        readOnly: false,
        t: tFor(lang),
        onActivate: noop,
        onReply: noop,
        editingKey: null,
        editingText: '',
        onEditStart: noop,
        onEditChange: noop,
        onEditCancel: noop,
        onEditSubmit: noop,
        onDeleteItem: noop,
        onClose: noop,
        onDraftConfirm: noop,
        onDraftCancel: noop,
      }),
    ),
  )
  const name = container.querySelector('.pdf-note-author')?.textContent
  act(() => root.unmount())
  container.remove()
  return name
}

describe('pdf note margin: the neutral author label', () => {
  it('vi shows "Người dùng" for "User"; en shows "User"; names stay verbatim', () => {
    expect(draftAuthorShown('vi', 'User')).toBe('Người dùng')
    expect(draftAuthorShown('en', 'User')).toBe('User')
    expect(draftAuthorShown('vi', 'Nguyễn An')).toBe('Nguyễn An')
    expect(draftAuthorShown('vi', '')).toBe('UniWork Office')
  })
})
