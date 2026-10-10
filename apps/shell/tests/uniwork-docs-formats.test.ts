import { describe, expect, it } from 'vitest'
import { sanitizeFilename } from '../src/main/uniwork-docs/formats'

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
