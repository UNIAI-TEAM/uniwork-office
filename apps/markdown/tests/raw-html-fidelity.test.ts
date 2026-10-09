import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { matchInlineHtml } from '../src/renderer/editor/rawHtml'
import { parseMarkdownToNodes } from '../src/renderer/editor/ops'
import { DiagramPreview } from '../src/renderer/editor/CodeBlockView'
import { diagramSvgDataUrl } from '../src/renderer/editor/diagrams'
import { parseDocText, serializeDocText } from '../src/renderer/markdown/docText'
import { buildSourceMap, spliceMarkdown } from '../src/renderer/markdown/sourceSplice'

// Undestroyed views leave DOMObserver flush timers that fire after jsdom teardown
const editors: Editor[] = []
afterAll(() => {
  for (const e of editors) e.destroy()
})

function createEditor(element?: HTMLElement): Editor {
  const editor = new Editor({
    element,
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
  return editor
}

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8')
}

/**
 * Open → save with every block re-serialized (what an edited block gets): the
 * raw HTML itself must survive the serializer, not only the block splicer.
 */
function openAndSave(editor: Editor, text: string): string {
  const envelope = parseDocText(text)
  editor.commands.setContent(envelope.body, { contentType: 'markdown' })
  return serializeDocText(envelope, editor.getMarkdown())
}

/** the App's save path: envelope + body through the block splicer (sourceSplice.ts) */
function openEditAndSave(editor: Editor, text: string, edit: (e: Editor) => void = () => {}) {
  const envelope = parseDocText(text)
  editor.commands.setContent(envelope.body, { contentType: 'markdown' })
  const map = buildSourceMap(editor, editor.state.doc, envelope.body)
  expect(map).not.toBeNull()
  edit(editor)
  return serializeDocText(envelope, spliceMarkdown(editor, editor.state.doc, map!))
}

describe('raw HTML round-trips byte-identically (open → save without edit)', () => {
  const editor = createEditor()

  const cases: Record<string, string> = {
    'block comment': '# T\n\n<!-- keep me -->\n\nafter\n',
    'multi-line comment': 'before\n\n<!--\n  a\n  b\n-->\n\nafter\n',
    'div-wrapped block':
      '<div align="center" class="x" onclick="alert(1)">\n  hi <b>there</b>\n</div>\n\ntext\n',
    'inline span': 'a <span style="color: #ff0000" data-k=\'v\'>red *text*</span> b\n',
    'inline comment': 'one <!-- hidden --> two\n',
    'details block':
      '<details>\n<summary>More <i>info</i></summary>\n\nBody **bold**.\n\n</details>\n',
    // <br>, <em>, <code>, <img src width> map to the schema (inlineTokens.ts) and are
    // re-serialized as markdown when their block is edited; these tags do not map
    'void and self-closing tags':
      'line<wbr>break, <img src="assets/a.png" width="30" align="left"> and <x-icon name="a"/> end\n',
    'html inside marks and links':
      '**bold <span class="k">html</span> inside** and [a <kbd>b</kbd> c](https://e.com)\n',
    'html in a list': '- item <sup>1</sup>\n- <kbd>Ctrl</kbd>\n',
    'raw html table': '<table>\n  <tr><td>a</td></tr>\n</table>\n',
  }

  for (const [name, md] of Object.entries(cases)) {
    it(name, () => {
      expect(openAndSave(editor, md)).toBe(md)
    })
  }

  it('mixed fixture', () => {
    const md = fixture('raw-html.md.txt')
    expect(openEditAndSave(editor, md)).toBe(md)
  })

  it('mixed fixture with CRLF line endings and a BOM', () => {
    const md = `\uFEFF${fixture('raw-html.md.txt').replace(/\n/g, '\r\n')}`
    expect(openEditAndSave(editor, md)).toBe(md)
  })

  it('autolinks and a bare < stay plain markdown', () => {
    expect(matchInlineHtml('<https://example.com>')).toBe(0)
    expect(matchInlineHtml('<team@example.com>')).toBe(0)
    expect(matchInlineHtml('< 2')).toBe(0)
    expect(matchInlineHtml('<span>a <span>b</span> c</span> d')).toBe(
      '<span>a <span>b</span> c</span>'.length,
    )
    expect(matchInlineHtml('<span>unclosed')).toBe('<span>'.length)
  })
})

describe('standard markdown saves exactly as before (golden)', () => {
  it('common fixture → the output captured before raw HTML preservation', () => {
    const editor = createEditor()
    expect(openAndSave(editor, fixture('common.md.txt'))).toBe(fixture('common.saved.md.txt'))
  })
})

describe('editing near raw HTML leaves it untouched', () => {
  it('typing into a nearby paragraph changes only that line', () => {
    const editor = createEditor()
    const md = fixture('raw-html.md.txt')
    const saved = openEditAndSave(editor, md, (e) => {
      let target = -1
      e.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.textContent === 'Nearby paragraph to edit.') {
          target = pos + node.nodeSize - 1
        }
      })
      expect(target).toBeGreaterThan(0)
      e.chain().setTextSelection(target).insertContent(' Edited.').run()
    })
    expect(saved).toBe(md.replace('Nearby paragraph to edit.', 'Nearby paragraph to edit. Edited.'))
  })

  it('editing the paragraph itself: mapped tags become markdown, the rest stays byte-identical', () => {
    const editor = createEditor()
    const md = 'a <b>x</b> and <span style="color: red">y</span> <!-- c --> end\n\nnext\n'
    const saved = openEditAndSave(editor, md, (e) => {
      e.chain()
        .setTextSelection(e.state.doc.child(0).nodeSize - 1)
        .insertContent('!')
        .run()
    })
    expect(saved).toBe('a **x** and <span style="color: red">y</span> <!-- c --> end!\n\nnext\n')
  })
})

describe('raw HTML is shown as text, never rendered into the editor DOM', () => {
  it('no element, attribute or handler from the document reaches the DOM', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createEditor(host)
    const md =
      '<div class="hero" onclick="alert(1)"><img src=x onerror="window.__rawHtmlPwned = 1"></div>\n\n' +
      'a <span class="evil" onmouseover="window.__rawHtmlPwned = 1">x</span> b\n\n' +
      '<script>window.__rawHtmlPwned = 1</script>\n\n<!-- note -->\n'
    editor.commands.setContent(md, { contentType: 'markdown' })

    const root = editor.view.dom
    expect(
      root.querySelector('.hero, .evil, script, img, [onclick], [onerror], [onmouseover]'),
    ).toBeNull()
    const blocks = [...root.querySelectorAll('.md-raw-html')].map((el) => el.textContent)
    expect(blocks).toContain(
      '<div class="hero" onclick="alert(1)"><img src=x onerror="window.__rawHtmlPwned = 1"></div>',
    )
    expect(blocks).toContain('<script>window.__rawHtmlPwned = 1</script>')
    expect(root.querySelector('.md-raw-html-comment')?.textContent).toBe('<!-- note -->')
    expect(root.querySelector('.md-raw-html-inline')?.textContent).toBe(
      '<span class="evil" onmouseover="window.__rawHtmlPwned = 1">x</span>',
    )
    expect((window as { __rawHtmlPwned?: number }).__rawHtmlPwned).toBeUndefined()
    // and the file still saves what was written (a mounted view appends an
    // empty trailing paragraph after a final non-paragraph block, as for code)
    expect(editor.getMarkdown().trimEnd()).toBe(md.trimEnd())
    host.remove()
  })
})

describe('conversions still degrade raw HTML', () => {
  it('model input: semantic tags map to marks, styling and comments are dropped', () => {
    const editor = createEditor()
    const nodes = parseMarkdownToNodes(
      editor,
      '<!-- c -->\n\na <span style="color: red">red</span> and <b>bold</b>\n\n<div>wrapped</div>',
    )
    const json = JSON.stringify(nodes.map((n) => n.toJSON()))
    expect(json).not.toContain('rawHtml')
    expect(json).not.toContain('<')
    // the comment degrades to an empty paragraph, exactly as before preservation
    const text = nodes
      .map((n) => n.textContent)
      .filter(Boolean)
      .join('\n')
    expect(text).toBe('a red and bold\nwrapped')
    expect(json).toContain('"bold"')
  })
})

describe('mermaid preview never injects the SVG markup', () => {
  const payload =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 120 40" onload="window.__mermaidPwned = 1">' +
    '<script>window.__mermaidPwned = 1</script>' +
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="window.__mermaidPwned = 1"></div></foreignObject>' +
    '<text x="10" y="20">A</text></svg>'

  it('renders an <img> with a data: SVG, no live SVG/script/handler in the DOM', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    flushSync(() => root.render(createElement(DiagramPreview, { svg: payload })))

    expect(container.querySelector('svg, script, foreignObject, [onload], [onerror]')).toBeNull()
    const img = container.querySelector('.md-diagram-preview img') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')!.startsWith('data:image/svg+xml')).toBe(true)
    expect((window as { __mermaidPwned?: number }).__mermaidPwned).toBeUndefined()

    root.unmount()
    container.remove()
  })

  it('the data URL pins the viewBox size so the diagram keeps its layout size', () => {
    const svg = decodeURIComponent(diagramSvgDataUrl(payload).split(',').slice(1).join(','))
    expect(svg).toMatch(/^<svg [^>]*width="120" height="40"/)
  })
})
