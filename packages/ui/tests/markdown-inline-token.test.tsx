import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../src/Markdown'

// `inlineToken` lets a host turn a pattern in the plain text (a `[S1]` citation marker) into its own
// element. It applies to plain-text runs only: never inside code, never in a link, and without it the
// output is what it always was.

const cite = {
  pattern: /\[S(\d+)\]/g,
  render: (m: RegExpMatchArray, key: number) =>
    m[1] === '1' ? createElement('b', { key, className: 'cite' }, m[1]) : m[0],
}
const html = (text: string, withToken = true) =>
  renderToStaticMarkup(
    createElement(Markdown, { text, ...(withToken ? { inlineToken: cite } : {}) }),
  )

describe('Markdown inlineToken', () => {
  it('renders a matched token with the host element', () => {
    expect(html('Frozen [S1].')).toBe(
      '<div class="ai-md"><p>Frozen <b class="cite">1</b>.</p></div>',
    )
  })

  it('leaves a token the host declines as plain text', () => {
    expect(html('Maybe [S2] so')).toBe('<div class="ai-md"><p>Maybe [S2] so</p></div>')
  })

  it('handles adjacent tokens and several per line', () => {
    expect(html('a [S1][S1] b [S1]')).toContain(
      'a <b class="cite">1</b><b class="cite">1</b> b <b class="cite">1</b>',
    )
  })

  it('works in list items, headings and table cells', () => {
    expect(html('- item [S1]')).toContain('<li>item <b class="cite">1</b></li>')
    expect(html('# Head [S1]')).toContain('<b class="cite">1</b>')
    expect(html('| a |\n| - |\n| x [S1] |')).toContain('<td>x <b class="cite">1</b></td>')
  })

  it('works next to bold and italic runs', () => {
    expect(html('**bold** then [S1] and *it*')).toBe(
      '<div class="ai-md"><p><strong>bold</strong> then <b class="cite">1</b> and <em>it</em></p></div>',
    )
  })

  it('never touches inline code or a fenced block', () => {
    expect(html('use `[S1]` now')).toBe('<div class="ai-md"><p>use <code>[S1]</code> now</p></div>')
    expect(html('```\n[S1]\n```')).toContain('<code>[S1]</code>')
  })

  it('never touches a markdown link', () => {
    expect(html('[see [S1]](https://x.example/a)')).not.toContain('class="cite"')
  })

  it('does not break when the pattern is not global (the host forgot the flag)', () => {
    const once = { ...cite, pattern: /\[S(\d+)\]/ }
    expect(
      renderToStaticMarkup(createElement(Markdown, { text: 'a [S1] b [S1]', inlineToken: once })),
    ).toContain('<b class="cite">1</b> b <b class="cite">1</b>')
  })

  it('without the prop the output is unchanged', () => {
    expect(html('Frozen [S1].', false)).toBe('<div class="ai-md"><p>Frozen [S1].</p></div>')
  })
})
