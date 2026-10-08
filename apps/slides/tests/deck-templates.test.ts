import { describe, expect, it } from 'vitest'
import {
  DECK_TEMPLATES,
  buildGalleryGenerateMessages,
  fillBuiltinTemplate,
  getDeckTemplate,
} from '../src/renderer/ai/deck-templates'

describe('deck-templates', () => {
  it('lists unique gallery templates with pages', () => {
    const ids = new Set(DECK_TEMPLATES.map((t) => t.id))
    expect(ids.size).toBe(DECK_TEMPLATES.length)
    for (const tpl of DECK_TEMPLATES) {
      expect(tpl.pages.length).toBeGreaterThanOrEqual(4)
      expect(tpl.approxPages).toBe(tpl.pages.length)
    }
  })

  it('fills topic into titles and briefs', () => {
    const filled = fillBuiltinTemplate('pitch-deck', 'Acme AI')
    expect(filled).not.toBeNull()
    expect(filled!.topic).toBe('Acme AI')
    expect(filled!.pages[0]!.title).toContain('Acme AI')
    expect(filled!.pages.every((p) => p.brief.includes('Acme AI') || p.title.includes('Acme AI'))).toBe(
      true,
    )
    expect(filled!.style.length).toBeGreaterThan(20)
  })

  it('rejects unknown ids', () => {
    expect(getDeckTemplate('nope')).toBeUndefined()
    expect(fillBuiltinTemplate('nope', 'x')).toBeNull()
    expect(buildGalleryGenerateMessages('nope', 'x', 'en')).toBeNull()
  })

  it('builds display + instruction for gallery send', () => {
    const msgs = buildGalleryGenerateMessages('quarterly-report', 'Sales Q3', 'vi')
    expect(msgs).not.toBeNull()
    expect(msgs!.displayText).toContain('Sales Q3')
    expect(msgs!.instruction).toContain('builtin_template: "quarterly-report"')
    expect(msgs!.instruction).toContain('generate_deck')
  })
})
