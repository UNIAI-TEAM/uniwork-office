import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARKDOWN_THEME_IDS } from '../src/shared/markdown-theme'

const css = readFileSync(resolve(__dirname, '../src/renderer/markdown-themes.css'), 'utf8')

function paperBlock(id: string): string {
  const open = `html[data-markdown-theme='${id}'] .doc-page {`
  const start = css.indexOf(open)
  expect(start, `${id} has a .doc-page paper block`).toBeGreaterThanOrEqual(0)
  return css.slice(start + open.length, css.indexOf('}', start))
}

// V1: `.doc-page` only declares `color` under html[data-doc-theme='light'], so a paper theme
// of the other mode than the UI inherited the UI text colour (contrast ~1.1). Each paper
// theme owns the ink it paints on its own paper.
describe('markdown paper themes own their text colour', () => {
  const themes = MARKDOWN_THEME_IDS.filter((id) => id !== 'default')

  it.each(themes)('%s sets the paper ink and the text tokens', (id) => {
    const block = paperBlock(id)
    expect(block).toMatch(/^\s*color:\s*var\(--text\);/m)
    expect(block).toMatch(/--text:\s*#/)
    expect(block).toMatch(/--text-primary:\s*#/)
    expect(block).toMatch(/--text-secondary:\s*(#|rgb)/)
    expect(block).toMatch(/--md-paper-light:\s*#/)
  })
})
