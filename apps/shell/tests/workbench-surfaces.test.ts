import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../src/renderer/src')
const css = readFileSync(join(SRC, 'home.css'), 'utf8')

/** every innermost `selector { body }` rule whose selector names a Workbench class */
function workbenchRules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    if (/\.wb-|\.skill-domain-/.test(selector)) out.push({ selector, body: m[2]! })
  }
  return out
}

describe('Workbench surfaces (redesign spec 2.2, 2.4, 5)', () => {
  it('the quick-add plus box is the only dashed border left', () => {
    const dashed = workbenchRules()
      .filter((r) => /dashed/.test(r.body))
      .map((r) => r.selector)
    expect(dashed).toEqual(['.wb-work-quick-plus'])
  })

  it('no pill radius, lifted button shadow or hover lift is left', () => {
    const banned =
      /--shadow-btn\b|--shadow-btn-lift|--shadow-btn-primary|--shadow-pill|--radius-16|--radius-30|999px|translateY\(/
    const left = workbenchRules()
      .filter((r) => banned.test(r.body))
      .map((r) => r.selector)
    expect(left).toEqual([])
  })

  it.each([
    'WorkTasksPane.tsx',
    'WorkCalendarPane.tsx',
    'NotesPane.tsx',
    'WorkErrorState.tsx',
    'WorkbenchModulePanes.tsx',
    'PracticeHome.tsx',
  ])('%s no longer uses the dashed state box or the panel card', (file) => {
    const src = readFileSync(join(SRC, file), 'utf8')
    expect(src).not.toContain('wb-work-state')
    expect(src).not.toContain('wb-panel')
  })

  it('pillar and module tabs use the Workbench buttons (the skill-confirm modal keeps .btn)', () => {
    const panes = readFileSync(join(SRC, 'WorkbenchModulePanes.tsx'), 'utf8')
    const notes = readFileSync(join(SRC, 'NotesPane.tsx'), 'utf8')
    const home = readFileSync(join(SRC, 'PracticeHome.tsx'), 'utf8')
    expect(panes).not.toMatch(/className="btn /)
    expect(notes).not.toMatch(/className="btn /)
    expect(home.match(/className="btn /g)).toHaveLength(2)
    expect(home).not.toContain('wb-chip"')
  })
})
