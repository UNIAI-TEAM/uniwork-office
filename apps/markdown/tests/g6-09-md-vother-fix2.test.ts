// G6-09 visual r2 (markdown): "Worked" has a singular form (N-4), and the step title / work-group
// summary rows share the panel's 2 px brand focus ring instead of a grey shadow (N-7).
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

describe('worked-steps label (N-4)', () => {
  const langs = Object.keys(strings) as Array<keyof typeof strings>
  const tFor =
    (lang: keyof typeof strings) => (key: 'aiWorkedSteps' | 'aiWorkedStepOne', p?: { n: number }) =>
      (strings[lang][key] as string).replace('{n}', String(p?.n ?? ''))

  it('reads "1 step" in English and keeps the plural for other counts', () => {
    expect(workedStepsLabel(tFor('en'), 1)).toBe('Worked · 1 step')
    expect(workedStepsLabel(tFor('en'), 2)).toBe('Worked · 2 steps')
    expect(workedStepsLabel(tFor('en'), 0)).toBe('Worked · 0 steps')
  })

  it('has a singular line in every locale', () => {
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

describe('step title / work-group summary focus ring (N-7)', () => {
  it.each(['.ai-work-group-summary:focus-visible', '.ai-step-title.clickable:focus-visible'])(
    'gives %s the standard 2 px brand ring token, no grey shadow',
    (selector) => {
      const body = rule(selector)
      expect(body).toMatch(/outline:\s*2px solid var\(--color-border-brand\)/)
      expect(body).toMatch(/outline-offset:\s*1px/)
      expect(body).not.toMatch(/box-shadow/)
    },
  )
})
