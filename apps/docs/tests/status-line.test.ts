import { afterEach, describe, expect, it } from 'vitest'
import { setModuleLang, statusText, t } from '../src/renderer/i18n/locale'

afterEach(() => setModuleLang('zh'))

describe('status-bar line kept as key + params', () => {
  it('is translated when drawn, so a language switch rewrites an "Opened …" line', () => {
    const line = { key: 'appOpenedFile', params: { name: 'Docx Simple.docx' } } as const
    setModuleLang('en')
    expect(statusText(line, t)).toBe('Opened Docx Simple.docx')
    setModuleLang('vi')
    expect(statusText(line, t)).toBe('Đã mở Docx Simple.docx')
  })

  it('passes ready text through unchanged', () => {
    setModuleLang('vi')
    expect(statusText('Đã lưu', t)).toBe('Đã lưu')
  })
})
