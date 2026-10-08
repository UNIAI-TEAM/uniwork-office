import { describe, expect, it, vi } from 'vitest'
import {
  buildTemplateBrief,
  extractSlotsFromUserText,
  resolveTemplateSlots,
} from '../src/renderer/src/my-ai-templates'

vi.mock('../src/renderer/src/workbench-pins', () => ({
  readClients: () => [
    {
      id: 'c1',
      name: 'Công ty ABC',
      contact: 'An',
      email: 'an@abc.vn',
    },
  ],
  readContracts: () => [],
  readMatters: () => [],
}))

describe('my-ai templates', () => {
  it('extracts client + topic from Vietnamese NL', () => {
    const s = extractSlotsFromUserText('Soạn báo giá cho khách VinGroup gói Pro')
    expect(s.client).toMatch(/VinGroup/i)
    expect(s.topic).toMatch(/Pro/i)
  })

  it('resolves sales-quote slots from clients + text', () => {
    const r = resolveTemplateSlots(
      'sales',
      'sales-quote',
      'Soạn báo giá cho khách ABC gói Premier',
    )
    expect(r).not.toBeNull()
    expect(r!.missing).toHaveLength(0)
    expect(r!.slots.client).toBe('Công ty ABC')
    expect(r!.slots.topic).toMatch(/Premier/i)
    expect(r!.clientRow?.email).toBe('an@abc.vn')
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
    expect(brief).toMatch(/Công ty ABC/)
    expect(brief).toMatch(/Bảng giá/)
    expect(brief).toMatch(/không bịa/i)
  })
})
