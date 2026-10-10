/**
 * Web frame: a relative picture the host has no copy of shows a placeholder that explains itself
 * (localised note drawn into the SVG) and carries an accessible name; the saved Markdown keeps the
 * authored `![alt](path)`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { strings } from '../src/renderer/i18n/strings'
import { missingImageUrl, isMissingImageUrl } from '../../../web/modules/markdown/missing-image'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
  vi.unstubAllGlobals()
})

function open(source: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: {
        onOpen: () => {},
        onUpdate: () => {},
        onKeyDown: () => false,
        onClose: () => {},
      },
      slashItems: () => [],
    }),
    content: '',
  })
  editors.push(editor)
  editor.commands.setContent(source, { contentType: 'markdown' })
  return editor
}

describe('missing picture placeholder in the editor', () => {
  it('has an accessible name and a localised explanation inside the picture', () => {
    // the web bridge's resolveAssetUrl / isMissingAsset (no assets in this document)
    vi.stubGlobal('markdownApi', {
      resolveAssetUrl: (src: string, note?: string) => missingImageUrl(src, note),
      isMissingAsset: (url: string) => isMissingImageUrl(url),
    })
    const editor = open('![diagram](assets/a.png)\n')
    const img = editor.view.dom.querySelector('img[src]')!
    expect(img.getAttribute('aria-label')).toContain('diagram')
    expect(img.getAttribute('aria-label')).toContain(strings.zh.imageMissingWeb)
    const svg = decodeURIComponent(img.getAttribute('src')!.split('#')[0]!.slice(33))
    expect(svg).toContain('assets/a.png')
    // the note is in the SVG (zh is the module-level default language of the test)
    expect(svg.replace(/<[^>]+>/g, '')).toContain('未显示')
    // the aria text is display-only: the document still saves its authored path
    expect(editor.getMarkdown()).toContain('![diagram](assets/a.png)')
    expect(editor.getMarkdown()).not.toContain('aria')
  })

  it('a real picture keeps no placeholder label', () => {
    vi.stubGlobal('markdownApi', {
      resolveAssetUrl: () => 'blob:https://x.test/1',
      isMissingAsset: () => false,
    })
    const editor = open('![diagram](assets/a.png)\n')
    expect(editor.view.dom.querySelector('img[src]')!.hasAttribute('aria-label')).toBe(false)
  })
})
