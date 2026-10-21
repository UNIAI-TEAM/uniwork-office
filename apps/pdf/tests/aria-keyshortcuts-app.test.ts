// @vitest-environment node
/**
 * UNI-2060 follow-up: controls whose tooltip shows no chord still announce their table row
 * (`aria-keyshortcuts`), and every ribbon tab that offers the collapse key announces it too.
 * The App is too big to mount in jsdom, so the wiring is read from its source.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP = readFileSync(fileURLToPath(new URL('../src/renderer/App.tsx', import.meta.url)), 'utf8')
const count = (re: RegExp) => [...APP.matchAll(re)].length

describe('PDF app controls', () => {
  it('every ribbon tab tip has its aria-keyshortcuts twin', () => {
    const tips = count(/data-tip=\{collapse\.tabTip\(/g)
    expect(tips).toBeGreaterThan(0)
    expect(count(/aria-keyshortcuts=\{collapse\.tabKeyshortcuts\(/g)).toBe(tips)
  })
})
