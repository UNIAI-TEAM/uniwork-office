/** the empty broken-picture frame names itself in the UI language, not in English */
import { Editor } from '@tiptap/core'
import type { Block } from '@genoffice/docx-engine'
import { afterEach, describe, expect, it } from 'vitest'
import { blocksToPmDoc } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { setModuleLang } from '../src/renderer/i18n/locale'

const frameText = (lang: 'vi' | 'en' | 'zh', previewText?: string): string | null => {
  setModuleLang(lang)
  const block = {
    type: 'passthrough',
    label: 'Image',
    brokenImage: true,
    imageWidthPx: 200,
    imageHeightPx: 120,
    docxIndex: 0,
    ...(previewText ? { previewText } : {}),
  } as unknown as Block
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: blocksToPmDoc([block]) as never,
  })
  const text = editor.view.dom.querySelector('.doc-broken-img-frame')?.textContent ?? null
  editor.destroy()
  return text
}

describe('broken picture frame label', () => {
  afterEach(() => setModuleLang('zh'))

  it('shows the localized "Picture" word when the file gives no alt text', () => {
    expect(frameText('vi')).toBe('Hình ảnh')
    expect(frameText('en')).toBe('Picture')
    expect(frameText('zh')).toBe('图片')
  })

  it('keeps the alt text of the picture when there is one', () => {
    expect(frameText('vi', 'Logo công ty')).toBe('Logo công ty')
  })
})
