// UNI-1232 FX2 (D-N5): on the web the host has its own Comments drawer (UniWork comments about the
// file), so the editor's pane says it holds the comments inside the document. Desktop keeps the
// plain "Comments (n)".
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import type { CommentInfo } from '@genoffice/docx-engine'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'
import { CommentsPanel } from '../src/renderer/components/CommentsPanel'
import { resetCapabilitiesForTest } from '../src/renderer/capabilities'
import { appStrings } from '../src/renderer/i18n/strings-app'

setModuleLang('en')

const noop = () => {}
let root: Root | null = null

function title(platform: 'web' | undefined, lang: 'en' | 'vi' = 'en'): string {
  Object.assign(window, {
    desktop: {
      onLanguageChanged: () => () => undefined,
      capabilities: platform ? { platform } : undefined,
    },
  })
  resetCapabilitiesForTest()
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'hello' }] }],
    },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root!.render(
      createElement(LocaleProvider, {
        initial: lang,
        children: createElement(CommentsPanel, {
          comments: [{ id: 'c1', author: 'A', text: 'x', done: false }] as CommentInfo[],
          docNode: editor.state.doc,
          composing: false,
          onSubmitNew: noop,
          onReply: noop,
          onEdit: noop,
          onResolve: noop,
          onCancelNew: noop,
          onDelete: noop,
          onClose: noop,
        }),
      }),
    ),
  )
  return container.querySelector('.comments-pane-title')!.textContent!.trim()
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe('comments pane title', () => {
  it('says "in this document" on the web', () => {
    expect(title('web')).toBe('Comments in this document (1)')
    expect(title('web', 'vi')).toBe('Bình luận trong tài liệu (1)')
  })

  it('keeps the plain title on desktop', () => {
    expect(title(undefined)).toBe('Comments (1)')
  })

  it('every locale has the web title with its count', () => {
    for (const [lang, strings] of Object.entries(appStrings)) {
      expect((strings as Record<string, string>).appCommentsTitleDoc, lang).toContain('{n}')
    }
  })
})
