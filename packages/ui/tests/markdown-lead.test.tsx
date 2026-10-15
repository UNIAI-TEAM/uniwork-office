import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../src/Markdown'

// The result chip is the first word of the answer paragraph, in the same node as the text
// (EXPERIENCE l.135, chipwire F6): Markdown places a `lead` inside its first paragraph.

const lead = createElement('span', { className: 'chip' }, 'Trả lời')
const html = (text: string, withLead = true) =>
  renderToStaticMarkup(createElement(Markdown, { text, ...(withLead ? { lead } : {}) }))

describe('Markdown lead', () => {
  it('opens the first paragraph', () => {
    expect(html('Hello **world**')).toBe(
      '<div class="ai-md"><p><span class="chip">Trả lời</span> Hello <strong>world</strong></p></div>',
    )
  })

  it('only the first block gets it, later paragraphs are untouched', () => {
    expect(html('one\n\ntwo')).toBe(
      '<div class="ai-md"><p><span class="chip">Trả lời</span> one</p><p>two</p></div>',
    )
  })

  it('a first block that is not a plain paragraph gets a lead paragraph before it', () => {
    expect(html('- a\n- b')).toBe(
      '<div class="ai-md"><p><span class="chip">Trả lời</span></p><ul><li>a</li><li>b</li></ul></div>',
    )
    expect(html('# Title\n\ntext')).toContain('<div class="ai-md"><p><span class="chip">')
  })

  it('an empty text still shows the lead', () => {
    expect(html('')).toBe('<div class="ai-md"><p><span class="chip">Trả lời</span></p></div>')
  })

  it('without a lead the output is what it always was', () => {
    expect(html('Hello', false)).toBe('<div class="ai-md"><p>Hello</p></div>')
  })
})
