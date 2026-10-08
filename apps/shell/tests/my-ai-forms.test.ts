import { describe, expect, it, vi } from 'vitest'
import {
  buildFormFillBrief,
  extractFormQuery,
  findFormForTemplate,
  looksLikeFormFill,
  matchFormByQuery,
  routeFormFill,
} from '../src/renderer/src/my-ai-forms'
import { getTemplateById } from '../src/renderer/src/my-ai-templates'

vi.mock('../src/renderer/src/workbench-pins', () => ({
  readForms: () => [
    {
      id: 'f1',
      title: 'Đơn xin nghỉ phép',
      note: 'HR',
      filePath: '/tmp/nghi-phep.docx',
      fileName: 'nghi-phep.docx',
      fileExt: 'docx',
    },
    {
      id: 'f2',
      title: 'Báo giá',
      filePath: '/tmp/bao-gia.docx',
      fileName: 'bao-gia.docx',
      fileExt: 'docx',
      templateId: 'sales-quote',
    },
    {
      id: 'f3',
      title: 'Chỉ có tên',
      note: 'no file',
    },
  ],
  readClients: () => [{ id: 'c1', name: 'Công ty ABC', email: 'an@abc.vn' }],
}))

describe('my-ai forms library', () => {
  it('detects form-fill intent', () => {
    expect(looksLikeFormFill('Điền biểu mẫu đơn xin nghỉ')).toBe(true)
    expect(looksLikeFormFill('Soạn theo mẫu báo giá')).toBe(true)
    expect(looksLikeFormFill('Mở lịch')).toBe(false)
  })

  it('extracts form query from NL', () => {
    expect(extractFormQuery('Điền biểu mẫu đơn xin nghỉ phép')).toMatch(/nghỉ phép/i)
  })

  it('matches form by title', () => {
    const f = matchFormByQuery('sales', 'nghỉ phép')
    expect(f?.id).toBe('f1')
    expect(f?.fileName).toBe('nghi-phep.docx')
  })

  it('routes to a specific uploaded form', () => {
    const r = routeFormFill('sales', 'Điền biểu mẫu nghỉ phép')
    expect(r).toEqual({ kind: 'form', formId: 'f1' })
  })

  it('links built-in template to uploaded form', () => {
    const tpl = getTemplateById('sales-quote')!
    const f = findFormForTemplate('sales', tpl)
    expect(f?.id).toBe('f2')
  })

  it('builds brief with excerpt + client', () => {
    const form = matchFormByQuery('sales', 'nghỉ phép')!
    const brief = buildFormFillBrief({
      form,
      vi: true,
      userHint: 'Điền biểu mẫu nghỉ phép cho khách ABC từ 10–12/10',
      excerpt: 'Họ tên: ____\nTừ ngày: ____',
      clientRow: { id: 'c1', name: 'Công ty ABC', email: 'an@abc.vn' },
    })
    expect(brief).toMatch(/Đơn xin nghỉ phép/)
    expect(brief).toMatch(/Công ty ABC/)
    expect(brief).toMatch(/Họ tên/)
    expect(brief).toMatch(/không bịa/i)
  })
})
