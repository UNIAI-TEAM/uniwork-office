import { describe, expect, it } from 'vitest'
import {
  UPLOAD_EXTENSIONS,
  copyTitleFor,
  formatForName,
  hasReplacementChar,
  sanitizeFilename,
  workingCopyName,
} from '../src/main/uniwork-docs/formats'

/**
 * R1-3: the upload picker's filter and the resolver are both derived from
 * BY_EXTENSION, so a test that compares them to each other is circular - a
 * removed or accidentally added key moves both sides together. The intended set
 * is pinned here, literally, so the offer and the resolver cannot drift apart
 * (and an accidental alias such as `.txt` cannot slip into the picker).
 */
describe('the upload format table', () => {
  const INTENDED = ['docx', 'xlsx', 'pptx', 'pdf', 'md', 'markdown', 'html', 'htm']
  const EXPECTED_FORMAT: Record<(typeof INTENDED)[number], string> = {
    docx: 'docx',
    xlsx: 'xlsx',
    pptx: 'pptx',
    pdf: 'pdf',
    md: 'md',
    markdown: 'md',
    html: 'html',
    htm: 'html',
  }

  it('offers exactly the eight extensions UniWork Office opens', () => {
    expect(UPLOAD_EXTENSIONS).toEqual(INTENDED)
  })

  it('resolves every offered extension to its canonical format, and no other', () => {
    for (const ext of INTENDED) {
      expect(formatForName(`plan.${ext}`), ext).toBe(EXPECTED_FORMAT[ext])
    }
    expect(formatForName('plan.markdown')).toBe('md')
    expect(formatForName('plan.htm')).toBe('html')
    expect(formatForName('plan.png')).toBeNull()
    expect(formatForName('plan')).toBeNull()
    expect(formatForName('photo.constructor')).toBeNull()
    expect(formatForName('photo.__proto__')).toBeNull()
  })

  it('resolves the extensions case-insensitively, as the file system does', () => {
    expect(formatForName('PLAN.DOCX')).toBe('docx')
    expect(formatForName('plan.MD')).toBe('md')
  })
})

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

  it('tests the part before the first dot for Windows device names, superscript ports included', () => {
    expect(sanitizeFilename('Nul.report', 'docx')).toBe('_Nul.report.docx')
    expect(sanitizeFilename('aux.v2', 'docx')).toBe('_aux.v2.docx')
    expect(sanitizeFilename('LPT1.txt', 'docx')).toBe('_LPT1.txt.docx')
    expect(sanitizeFilename('COM¹', 'docx')).toBe('_COM¹.docx')
    expect(sanitizeFilename('lpt³.log', 'docx')).toBe('_lpt³.log.docx')
    expect(sanitizeFilename('COM²', 'docx')).toBe('_COM².docx')
    // not a device name: more than the bare stem
    expect(sanitizeFilename('console.log', 'docx')).toBe('console.log.docx')
    expect(sanitizeFilename('Nulla', 'docx')).toBe('Nulla.docx')
  })

  it('cuts a long title by code points, so an emoji on the limit stays whole', () => {
    const emoji = '\u{1F600}'
    const straddle = `${'a'.repeat(119)}${emoji}tail`
    const cut = sanitizeFilename(straddle, 'docx')
    expect(cut).toBe(`${'a'.repeat(119)}${emoji}.docx`)
    expect(cut.isWellFormed()).toBe(true)
    const manyEmoji = sanitizeFilename(emoji.repeat(130), 'docx')
    expect(Array.from(manyEmoji)).toHaveLength(120 + '.docx'.length)
    expect(manyEmoji.isWellFormed()).toBe(true)
  })

  it('replaces a lone surrogate with an underscore instead of leaving it to the file system', () => {
    expect(sanitizeFilename('a\ud800b', 'docx')).toBe('a_b.docx')
    expect(sanitizeFilename('x\udc00', 'docx')).toBe('x_.docx')
    expect(sanitizeFilename('ok \u{1F600} fine\ud83d', 'docx')).toBe('ok \u{1F600} fine_.docx')
    expect(sanitizeFilename('a\ud800b', 'docx').isWellFormed()).toBe(true)
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

describe('copyTitleFor (G5-12, BE-12F-04)', () => {
  it('keeps the format extension last and cuts a 600-rune title to the 500-rune server cap', () => {
    const title = copyTitleFor(`${'x'.repeat(600)}.docx`, '(my version)', 'docx')
    expect(Array.from(title)).toHaveLength(500)
    expect(title.endsWith(' (my version).docx')).toBe(true)
  })

  it('counts runes, not UTF-16 units: an astral-plane title is cut on a code point boundary', () => {
    const title = copyTitleFor('😀'.repeat(600), '(my version)', 'docx')
    expect(Array.from(title)).toHaveLength(500)
    expect(title.endsWith(' (my version)')).toBe(true)
    expect(title).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })

  it('replaces a lone surrogate with _ instead of passing it to the server', () => {
    const lone = `a${String.fromCharCode(0xd83d)}b`
    expect(copyTitleFor(`${lone}.docx`, '(my version)', 'docx')).toBe('a_b (my version).docx')
  })

  it('adds the suffix to a title without the extension and ignores another format extension', () => {
    expect(copyTitleFor('Plan', '(my version)', 'docx')).toBe('Plan (my version)')
    expect(copyTitleFor('Plan.xlsx', '(my version)', 'docx')).toBe('Plan.xlsx (my version)')
  })
})

describe('UNI-2212 names of a converted legacy copy', () => {
  it('sanitizeFilename drops the legacy suffix of the pair instead of stacking it', () => {
    expect(sanitizeFilename('Budget.xls', 'xlsx')).toBe('Budget.xlsx')
    expect(sanitizeFilename('Memo.DOC', 'docx')).toBe('Memo.docx')
    expect(sanitizeFilename('Deck.ppt', 'pptx')).toBe('Deck.pptx')
    // a legacy suffix of another family is part of the name
    expect(sanitizeFilename('Budget.xls', 'docx')).toBe('Budget.xls.docx')
  })

  it('copyTitleFor names the copy of a legacy title as OOXML', () => {
    expect(copyTitleFor('Plan.ppt', '(mine)', 'pptx')).toBe('Plan (mine).pptx')
    expect(copyTitleFor('Plan.ppt', '(mine)', 'docx')).toBe('Plan.ppt (mine)')
  })
})
