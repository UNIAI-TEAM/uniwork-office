import { describe, expect, it } from 'vitest'
import {
  buildTemplateBrief,
  extractSlotsFromUserText,
  resolveTemplateSlots,
} from '../src/renderer/src/my-ai-templates'

describe('my-ai templates', () => {
  it('extracts client + topic from Vietnamese NL', () => {
    const s = extractSlotsFromUserText('Soạn báo giá cho khách VinGroup gói Pro')
    expect(s.client).toMatch(/VinGroup/i)
    expect(s.topic).toMatch(/Pro/i)
  })

  it('resolves sales-quote slots from the request text', () => {
    const r = resolveTemplateSlots(
      'sales',
      'sales-quote',
      'Soạn báo giá cho khách ABC gói Premier',
    )
    expect(r).not.toBeNull()
    expect(r!.missing).toHaveLength(0)
    expect(r!.slots.client).toBe('ABC')
    expect(r!.slots.party).toBe('ABC')
    expect(r!.slots.topic).toMatch(/Premier/i)
  })

  it('reports missing required slots', () => {
    const r = resolveTemplateSlots('sales', 'sales-quote', 'Soạn báo giá Word')
    expect(r).not.toBeNull()
    expect(r!.missing.map((m) => m.id)).toContain('topic')
  })

  it('builds structured brief with outline', () => {
    const r = resolveTemplateSlots(
      'sales',
      'sales-quote',
      'Soạn báo giá cho khách ABC gói Premier',
    )!
    const brief = buildTemplateBrief(r, true)
    expect(brief).toMatch(/Báo giá/)
    expect(brief).toMatch(/Khách hàng: ABC/)
    expect(brief).toMatch(/Bảng giá/)
    expect(brief).toMatch(/không bịa/i)
  })
})
