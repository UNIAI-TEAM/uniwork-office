// G6-09 N-8: the line saying what Roll back kept (after a mid-turn Save) was a small tertiary
// paragraph next to the grey hint. It takes the panel's existing warning/notice look, tokens only.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')

/** declarations of the first rule whose selector list contains `selector` */
function ruleFor(selector: string): string {
  const re = new RegExp(`(^|\\n)([^{}\\n]*${selector.replace(/[.]/g, '\\.')}[^{}]*)\\{([^}]*)\\}`)
  const m = re.exec(css)
  return m ? m[3] : ''
}

describe('rollback-kept notice style', () => {
  it('uses the warning tokens (background, border, text) and no raw colour', () => {
    const rule = ruleFor('.ai-run-stopped.ai-rollback-kept')
    expect(rule, 'rule exists').not.toBe('')
    expect(rule).toMatch(/background:\s*var\(--warning-bg\)/)
    expect(rule).toMatch(/border:\s*1px solid var\(--warning-border\)/)
    expect(rule).toMatch(/color:\s*var\(--warning-text\)/)
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/)
  })
})
