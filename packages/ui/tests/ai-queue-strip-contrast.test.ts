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

describe('queue strip action glyphs', () => {
  // V9: --icon-muted is 1.7:1 on the light strip and 2.5:1 on the dark one (needs 3:1)
  it.each(['.ai-queue-clear', '.ai-queue-pause', '.ai-queue-action'])(
    '%s uses a legible token, not --icon-muted',
    (name) => {
      const decl = rule(src('ai-queue-strip.css'), `.ai-queue-strip ${name}`)
      expect(decl).toMatch(/color:\s*var\(--text-secondary\)/)
      expect(decl).not.toMatch(/icon-muted/)
    },
  )
})
