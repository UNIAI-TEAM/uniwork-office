// G6-09 visual r2 (pdf): the paused-edits notice is true for a read-only run too (N-5), and the
// step title / work-group summary rows share the panel's 2 px brand focus ring (N-7).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { strings } from '../src/renderer/i18n/strings'

const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')

function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

describe('paused-edits notice wording (N-5)', () => {
  it('does not claim the assistant edits the document, in en and vi', () => {
    expect(strings.en.aiEditsPaused).toBe(
      'The assistant is working on this document. Your edits are paused; stop the assistant to continue.',
    )
    expect(strings.vi.aiEditsPaused).toBe(
      'Trợ lý đang làm việc với tài liệu này. Bạn tạm thời không sửa được; hãy dừng trợ lý để tiếp tục.',
    )
  })

  it('no locale still says the assistant is editing (en/vi anchors) and every locale keeps the stop hint', () => {
    const langs = Object.keys(strings) as Array<keyof typeof strings>
    for (const lang of langs) expect(strings[lang].aiEditsPaused, lang).toBeTruthy()
    expect(strings.en.aiEditsPaused).not.toMatch(/is editing/)
    expect(strings.vi.aiEditsPaused).not.toMatch(/chỉnh sửa tài liệu/)
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
