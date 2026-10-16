// G6-09 visual fix r1 (pdf): the blocked "Undo this run" button reads as disabled, "Undo this run"
// and "View changes" share the panel's standard 2 px focus ring, and "Worked" has a singular form.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { strings } from '../src/renderer/i18n/strings'
import { workedStepsLabel } from '../src/renderer/ai/worked-steps-label'

const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')

function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

describe('pdf run undo + view changes buttons (F9)', () => {
  it('draws a blocked Undo this run with the disabled look, not the enabled one', () => {
    const blocked = rule(".ai-run-undo-btn[aria-disabled='true']")
    expect(blocked).toMatch(/background:\s*var\(--color-bg-subtle\)/)
    expect(blocked).toMatch(/color:\s*var\(--color-text-tertiary\)/)
    expect(blocked).toMatch(/cursor:\s*not-allowed/)
    expect(rule(".ai-run-undo-btn[aria-disabled='true']:hover")).toMatch(
      /background:\s*var\(--color-bg-subtle\)/,
    )
  })

  it.each(['.ai-run-undo-btn:focus-visible', '.ai-result-view-changes:focus-visible'])(
    'gives %s the standard 2 px ring token (same as the ask card)',
    (selector) => {
      const body = rule(selector)
      expect(body).toMatch(/outline:\s*2px solid var\(--color-border-brand\)/)
      expect(body).toMatch(/outline-offset:\s*1px/)
      expect(body).not.toMatch(/box-shadow/)
    },
  )
})

describe('worked-steps label (F7)', () => {
  const langs = Object.keys(strings) as Array<keyof typeof strings>
  const tFor =
    (lang: keyof typeof strings) => (key: 'aiWorkedSteps' | 'aiWorkedStepOne', p?: { n: number }) =>
      (strings[lang][key] as string).replace('{n}', String(p?.n ?? ''))

  it('reads "1 step" in English and keeps the plural for other counts', () => {
    expect(workedStepsLabel(tFor('en'), 1)).toBe('Worked · 1 step')
    expect(workedStepsLabel(tFor('en'), 2)).toBe('Worked · 2 steps')
    expect(workedStepsLabel(tFor('en'), 0)).toBe('Worked · 0 steps')
  })

  it('has a singular line in every locale, different from the plural one where the noun inflects', () => {
    for (const lang of langs) {
      const one = workedStepsLabel(tFor(lang), 1)
      expect(one, lang).toMatch(/1|一|واحد|אחד/)
      expect(one, lang).not.toContain('{n}')
    }
    expect(workedStepsLabel(tFor('fr'), 1)).toBe('Terminé · 1 étape')
    expect(workedStepsLabel(tFor('de'), 1)).toBe('Erledigt · 1 Schritt')
    expect(workedStepsLabel(tFor('vi'), 1)).toBe('Đã xử lý · 1 bước')
  })
})

describe('edited-hint wrap (F11)', () => {
  it('balances the grey "Not saved" hint so a narrow panel does not strand one word', () => {
    expect(rule('.ai-result-edited-hint')).toMatch(/text-wrap:\s*balance/)
  })
})
