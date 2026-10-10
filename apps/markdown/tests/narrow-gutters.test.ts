/**
 * Visual r2 R2-02: at 390 px the page kept 72 px gutters (~210 px of text). The gutters now follow
 * the width the page gets (container query on the scroll pane, so an open AI panel counts too).
 * jsdom has no layout, so this pins the stylesheet contract; the real widths are checked by the
 * web e2e screenshots.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '..', 'src/renderer/styles.css'), 'utf8')

function containerBlock(name: string, maxWidth: number): string {
  const head = `@container ${name} (max-width: ${maxWidth}px) {`
  const at = css.indexOf(head)
  expect(at, head).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('\n}\n', at))
}

describe('narrow page gutters', () => {
  it('the scroll pane and the source pane are size containers', () => {
    expect(css).toMatch(/\.editor-scroll \{[^}]*container: md-page \/ inline-size;/)
    expect(css).toMatch(/\.source-pane \{[^}]*container: md-source \/ inline-size;/)
  })

  it('the page gutter shrinks in steps down to a phone-sized 16 px', () => {
    expect(containerBlock('md-page', 760)).toMatch(/\.doc-page \{\s*padding: 32px 40px 96px;/)
    expect(containerBlock('md-page', 520)).toMatch(/\.doc-page \{\s*padding: 24px 16px 80px;/)
  })

  it('the source view follows, after its own base rules so the cascade lets it win', () => {
    expect(containerBlock('md-source', 520)).toContain('padding-inline: 16px')
    expect(css.indexOf('@container md-source (max-width: 520px)')).toBeGreaterThan(
      css.indexOf('.source-textarea {'),
    )
  })
})
