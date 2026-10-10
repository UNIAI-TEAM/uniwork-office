import { describe, expect, it } from 'vitest'
import {
  hasReplacementChar,
  sanitizeFilename,
  workingCopyName,
} from '../src/main/uniwork-docs/formats'

describe('sanitizeFilename', () => {
  it('replaces separators, reserved and control characters with underscores', () => {
    const name = `a${String.fromCharCode(0)}b${String.fromCharCode(0x1f)}c${String.fromCharCode(0x7f)}d<e>f:g"h/i${String.fromCharCode(92)}j|k?l*m`
    expect(sanitizeFilename(name, 'docx')).toBe('a_b_c_d_e_f_g_h_i_j_k_l_m.docx')
  })

  it('keeps ordinary names and tabs only as the format extension requires', () => {
    expect(sanitizeFilename('Plan 2026.docx', 'docx')).toBe('Plan 2026.docx')
    expect(sanitizeFilename('Plan', 'xlsx')).toBe('Plan.xlsx')
  })

  it('trims dots and spaces, avoids Windows device names and never returns an empty base', () => {
    expect(sanitizeFilename('  ..report.. ', 'pdf')).toBe('report.pdf')
    expect(sanitizeFilename('CON', 'docx')).toBe('_CON.docx')
    expect(sanitizeFilename('...', 'docx')).toBe('document.docx')
  })
})

describe('workingCopyName', () => {
  it('names the copy after the document title, with the format extension', () => {
    expect(workingCopyName('Báo cáo Trình chiếu', 'upload.docx', 'docx')).toBe(
      'Báo cáo Trình chiếu.docx',
    )
    expect(workingCopyName('Bảng tính.xlsx', 'old-name.xlsx', 'xlsx')).toBe('Bảng tính.xlsx')
  })

  it('falls back to the stored upload name when the title is empty or carries U+FFFD', () => {
    expect(workingCopyName('   ', 'Ghi chú.md', 'md')).toBe('Ghi chú.md')
    expect(workingCopyName('B\uFFFDo c\uFFFDo.docx', 'Báo cáo.docx', 'docx')).toBe('Báo cáo.docx')
  })

  it('never lets a replacement character into a file name', () => {
    expect(workingCopyName('B\uFFFDo.docx', 'B\uFFFDo.docx', 'docx')).toBe('B_o.docx')
    expect(sanitizeFilename('B\uFFFDo', 'docx')).toBe('B_o.docx')
    expect(hasReplacementChar('Báo cáo')).toBe(false)
    expect(hasReplacementChar('B\uFFFDo')).toBe(true)
  })

  it('keeps Vietnamese diacritics (precomposed and combining) untouched', () => {
    const nfd = 'Tri\u0300nh chie\u0302\u0301u'
    expect(sanitizeFilename(nfd, 'pptx')).toBe(`${nfd}.pptx`)
    expect(sanitizeFilename('Trình chiếu', 'pptx')).toBe('Trình chiếu.pptx')
  })
})
