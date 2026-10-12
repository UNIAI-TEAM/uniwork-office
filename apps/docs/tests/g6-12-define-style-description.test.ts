// G6-12 #13: define_style must point the model at a tool that exists. There is
// no apply_style tool; a style goes on paragraphs through apply_ops' applyStyle op.
import { describe, expect, it } from 'vitest'
import { AGENT_TOOLS } from '../src/renderer/ai/tools'

describe('define_style description', () => {
  const names = new Set(AGENT_TOOLS.map((t) => t.name))
  const def = AGENT_TOOLS.find((t) => t.name === 'define_style')!

  it('names no tool that does not exist', () => {
    expect(names.has('apply_style')).toBe(false)
    expect(def.description).not.toContain('apply_style')
  })

  it('names the real path: the applyStyle op of apply_ops', () => {
    expect(names.has('apply_ops')).toBe(true)
    expect(def.description).toContain('apply_ops')
    expect(def.description).toContain('applyStyle')
  })
})
