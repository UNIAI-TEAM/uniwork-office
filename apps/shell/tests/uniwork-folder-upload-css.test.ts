import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  join(__dirname, '../src/renderer/src/uniwork-folder-upload/folder-upload.css'),
  'utf8',
)

/** the declarations of the first rule whose selector list has `selector` (comments dropped) */
function rule(selector: string): string {
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const [selectors, body] = chunk.split('{')
    if (body !== undefined && selectors!.split(',').some((one) => one.trim() === selector)) {
      return body
    }
  }
  return ''
}

describe('folder-upload.css', () => {
  it('FU-V4: a tinted bar keeps its own background under the action hover (dark contrast)', () => {
    for (const tone of ['ok', 'info', 'warn', 'error']) {
      const body = rule(`.fu-bar-${tone} .fu-bar-action:hover`)
      expect(body, tone).toContain('background: transparent')
      expect(body, tone).not.toContain('bg-hover-strong')
    }
  })

  it('FU-V7: the rename note has room above it', () => {
    expect(rule('.fu-dialog .fu-note')).toMatch(/margin:\s*10px 0 0/)
    // .modal p (0,1,1) would otherwise beat a bare .fu-note (0,1,0)
    expect(rule('.fu-note')).toBe('')
  })

  it('the folder-upload error keeps its 10px gap above .uw-act .uw-act-error (0,2,0)', () => {
    expect(rule('.uw-act .uw-act-error.fu-error')).toMatch(/margin-top:\s*10px/)
    expect(rule('.fu-error')).toBe('')
  })

  it('FU-V3: the bars keep a fixed corner as the fallback until the pane is measured', () => {
    expect(rule('.fu-bars')).toContain('position: fixed')
  })

  it('uses no raw colors (theming rules)', () => {
    const raw = css.split('\n').filter((line) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line))
    expect(raw).toEqual([])
  })
})
