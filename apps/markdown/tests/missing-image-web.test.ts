/**
 * Web frame: a relative picture the host has no copy of shows a placeholder that explains itself
 * (localised note drawn into the SVG) and carries an accessible name; the saved Markdown keeps the
 * authored `![alt](path)`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { refreshWebPictures } from '../src/renderer/editor/localImage'
import { strings } from '../src/renderer/i18n/strings'
import {
  missingImageUrl,
  isMissingImageUrl,
  unresolveMissingImage,
} from '../../../web/modules/markdown/missing-image'

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

describe('fresh picture URLs (A1b): refreshWebPictures redraws what is on screen', () => {
  /** the bridge's store, reduced: path -> URL, plus the URL every picture ever showed -> path */
  function bridge(map: Map<string, string>) {
    const former = new Map<string, string>()
    return {
      resolveAssetUrl: (src: string, note?: string) => map.get(src) ?? missingImageUrl(src, note),
      isMissingAsset: (url: string) => isMissingImageUrl(url),
      unresolveAssetUrl: (url: string) => {
        for (const [path, u] of map) if (u === url) return path
        return former.get(url) ?? unresolveMissingImage(url)
      },
      remember: (url: string, path: string) => former.set(url, path),
    }
  }

  it('a typed path that got its URL, an expired URL swapped, a refused one made missing', () => {
    const map = new Map<string, string>([['assets/a.png', '/f/a1']])
    const api = bridge(map)
    vi.stubGlobal('markdownApi', api)
    const editor = open('![a](assets/a.png)\n\n![b](./typed.png)\n')
    const imgs = () => [...editor.view.dom.querySelectorAll('img[src]')]
    expect(imgs().map((i) => i.getAttribute('src'))).toEqual([
      '/f/a1',
      expect.stringMatching(/^data:image\/svg\+xml/),
    ])
    const markdown = editor.getMarkdown()

    // the host answered for ./typed.png and re-signed assets/a.png
    map.set('./typed.png', '/f/typed')
    api.remember('/f/a1', 'assets/a.png')
    map.set('assets/a.png', '/f/a2')
    refreshWebPictures(editor.view.dom)
    expect(imgs().map((i) => i.getAttribute('src'))).toEqual(['/f/a2', '/f/typed'])
    expect(imgs()[1]!.hasAttribute('aria-label')).toBe(false)

    // refused for good: back to the labelled placeholder
    api.remember('/f/a2', 'assets/a.png')
    map.delete('assets/a.png')
    refreshWebPictures(editor.view.dom)
    expect(api.isMissingAsset(imgs()[0]!.getAttribute('src')!)).toBe(true)
    expect(imgs()[0]!.getAttribute('aria-label')).toContain('a')

    // the document never saw any of it
    expect(editor.getMarkdown()).toBe(markdown)
  })

  it('leaves remote and data: pictures alone', () => {
    vi.stubGlobal('markdownApi', bridge(new Map()))
    const editor = open('![r](https://x.test/r.png)\n')
    refreshWebPictures(editor.view.dom)
    expect(editor.view.dom.querySelector('img[src]')!.getAttribute('src')).toBe(
      'https://x.test/r.png',
    )
  })
})
