import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = (f: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src', f), 'utf8')

/** the declarations of the first rule whose selector is exactly `selector` */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} is styled`).toBeGreaterThanOrEqual(0)
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

describe('composer footer: model picker and usage chip', () => {
  // V5: the picker chip refused to shrink (flex-shrink: 0) inside a shrinking wrapper, so a
  // crowded footer (Docs: picker + session chip + attach + track-changes + send) painted the
  // chip label over the usage chip. The label now yields (ellipsis) and the usage chip holds.
  it('lets the model chip shrink to an ellipsis instead of spilling over its neighbours', () => {
    const chip = rule(src('ai-model-picker.css'), '.ai-model-chip')
    expect(chip).not.toMatch(/flex-shrink:\s*0/)
    expect(chip).toMatch(/min-width:\s*\d+px/)
    expect(rule(src('ai-model-picker.css'), '.ai-model-chip-text')).toMatch(
      /text-overflow:\s*ellipsis/,
    )
  })

  it('keeps the usage chip at its natural width', () => {
    expect(rule(src('ai-usage.css'), '.ai-usage-chip')).toMatch(/flex-shrink:\s*0/)
  })

  // V8: --text-tertiary on white is 3.05:1 at 11 px (needs 4.5:1)
  it('paints the usage chip with --text-secondary', () => {
    const decl = rule(src('ai-usage.css'), '.ai-usage-chip')
    expect(decl).toMatch(/color:\s*var\(--text-secondary\)/)
    expect(decl).not.toMatch(/text-tertiary/)
  })
})
