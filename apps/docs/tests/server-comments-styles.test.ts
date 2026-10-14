/**
 * G8-12 (UNI-1407): the server-comment highlight on the page is its own colour (V12-6), and the panel's
 * composer footer stays on one row in the 300 px column (V12-5). The page highlight is screen-only chrome
 * drawn over the document, so it has tokens in the light page and the dark page (CLAUDE.md theming rules).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')

function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, selector).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('server comment highlight (V12-6)', () => {
  it('uses its own tokens, not the in-file comment ones', () => {
    const r = rule('.doc-server-comment')
    expect(r).toContain('var(--docs-paper-server-comment-bg)')
    expect(r).toContain('var(--docs-paper-server-comment-line)')
    expect(r).not.toContain('--docs-paper-comment-')
  })

  it('defines both tokens for the light page and for the dark page', () => {
    const defs = css.match(/--docs-paper-server-comment-line: [^;]+;/g) ?? []
    expect(defs).toHaveLength(2)
    expect(new Set(defs).size).toBe(2)
    expect(css.match(/--docs-paper-server-comment-bg: [^;]+;/g)).toHaveLength(2)
  })
})

describe('server comment panel layout (V12-5)', () => {
  it('keeps hint, Cancel and Send on one row and the panel fills its column', () => {
    expect(css).toMatch(/\.docs-server-comments \.collab-composer-actions \{[^}]*flex-wrap: nowrap/)
    expect(css).toMatch(/\.docs-server-comments \.collab-composer-hint \{[^}]*min-width: 0/)
    expect(css).toMatch(/\.docs-server-comments \.docs-server-panel \{[^}]*flex: 1 1 auto/)
  })
})
