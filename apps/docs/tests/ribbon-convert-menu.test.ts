// Home → Convert mirrors the PDF app's converter dropdown: one entry per
// export format, routed to the same handlers as the native File menu.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { computeFormatState } from '../src/renderer/components/ribbon-format-state'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { t } from '../src/renderer/i18n/locale'
import { ribbonProps } from './helpers/ribbon-props'

describe('Home → Convert', () => {
  let editor: Editor
  let root: Root
  let container: HTMLElement
<<<<<<< ours
  const onConvert = vi.fn()
=======
  const onCommand = vi.fn()
>>>>>>> theirs

  beforeEach(() => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'hello' }] }],
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    editor.destroy()
<<<<<<< ours
    onConvert.mockClear()
=======
    onCommand.mockClear()
>>>>>>> theirs
  })

  function render(hasDoc: boolean) {
    act(() =>
      root.render(
        createElement(Ribbon, {
          ...ribbonProps(editor, computeFormatState(editor)),
          hasDoc,
<<<<<<< ours
          onConvert,
=======
          onCommand,
>>>>>>> theirs
        }),
      ),
    )
    return [...container.querySelectorAll<HTMLButtonElement>('button.rb-big')].find(
      (b) => b.textContent === t('ribbonConvert'),
    )!
  }

  it('offers PDF, HTML, Markdown and images and routes the pick', () => {
    const btn = render(true)
    expect(btn.disabled).toBe(false)
    act(() => btn.click())
    const items = [...container.querySelectorAll<HTMLButtonElement>('.spacing-menu button')]
    expect(items.map((b) => b.textContent)).toEqual([
      t('ribbonConvertPdf'),
      t('ribbonConvertHtml'),
      t('ribbonConvertMarkdown'),
      t('ribbonConvertImages'),
    ])
    act(() => items[2].click())
<<<<<<< ours
    expect(onConvert).toHaveBeenCalledWith('md')
=======
    expect(onCommand).toHaveBeenCalledWith('export-markdown', undefined)
>>>>>>> theirs
    expect(container.querySelector('.spacing-menu')).toBeNull()
  })

  it('is disabled without a document', () => {
    expect(render(false).disabled).toBe(true)
  })
})
