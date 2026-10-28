import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  resolve(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
  'utf8',
)
const rule = (selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('bulk bar narrow-pane layout (UNI-2068 TVZ-2)', () => {
  it('the clear button never breaks its label or shrinks', () => {
    const clear = rule('.dl-bulk-clear')
    expect(clear).toContain('white-space: nowrap')
    expect(clear).toContain('flex: none')
  })

  it('the actions wrap as a group inside their own box, before the clear button', () => {
    const actions = rule('.dl-bulk-actions')
    expect(actions).toContain('flex-wrap: wrap')
    expect(actions).toContain('min-width: 0')
  })

  it('matches the web bulk bar radius (12px), gap (6px), and button radius (8px) (TV-2275-04)', () => {
    const bar = rule('.dl-bulk-bar')
    expect(bar).toContain('border-radius: var(--radius-12)')
    expect(bar).toContain('gap: 6px')
    expect(rule('.dl-bulk-actions')).toContain('gap: 6px')
    expect(rule('.dl-bulk-action')).toContain('border-radius: var(--radius-8)')
    expect(rule('.dl-bulk-clear')).toContain('border-radius: var(--radius-8)')
  })
})
