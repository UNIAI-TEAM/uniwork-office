/**
 * G6-09 visual r1 F11: at the 360 px panel the grey "Not saved — undo with Ctrl+Z…" hint left a
 * one-word last line in vi. jsdom has no layout, so this pins the stylesheet contract; the visual
 * re-test looks at the real wrap.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '..', 'src/renderer/styles.css'), 'utf8')

describe('the edited-run hint', () => {
  it('wraps balanced and may shrink to a line of its own beside the button', () => {
    const rule = /\.ai-result-edited-hint \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/text-wrap:\s*balance;/)
    expect(rule).toMatch(/flex:\s*1 1 /)
    expect(rule).toMatch(/min-width:\s*0;/)
  })
})
