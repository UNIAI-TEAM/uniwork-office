import { describe, expect, it } from 'vitest'
import {
  convertedTitle,
  conversionFor,
  isLegacyConversion,
  legacyTarget,
} from '../src/main/uniwork-docs/legacy-cloud'
import { legacyOfFile } from '../src/main/uniwork-docs/formats'

const OOXML = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describe('legacy cloud documents (UNI-2212)', () => {
  it('maps each legacy format to its own OOXML family only', () => {
    expect(legacyTarget('doc')).toBe('docx')
    expect(legacyTarget('xls')).toBe('xlsx')
    expect(legacyTarget('ppt')).toBe('pptx')
    expect(conversionFor('xls')).toEqual({ from: 'xls', to: 'xlsx' })
    expect(isLegacyConversion({ from: 'xls', to: 'xlsx' })).toBe(true)
    expect(isLegacyConversion({ from: 'xls', to: 'docx' })).toBe(false)
    expect(isLegacyConversion({ from: 'docx', to: 'docx' })).toBe(false)
    expect(isLegacyConversion(null)).toBe(false)
  })

  it('reads the live version MIME type first, then the upload name, then the title', () => {
    expect(legacyOfFile({ mimeType: 'application/vnd.ms-excel', filename: 'a.bin' }, 'a')).toBe(
      'xls',
    )
    expect(legacyOfFile({ mimeType: 'application/msword; x=1', filename: '' }, 'a')).toBe('doc')
    expect(legacyOfFile({ mimeType: '', filename: 'deck.PPT' }, 'deck')).toBe('ppt')
    expect(legacyOfFile({ mimeType: '', filename: '' }, 'Budget.xls')).toBe('xls')
  })

  it('an OOXML live version is never legacy, whatever the title still says', () => {
    expect(legacyOfFile({ mimeType: OOXML, filename: 'budget.xlsx' }, 'Budget.xls')).toBeNull()
    expect(legacyOfFile({ mimeType: OOXML, filename: 'budget.xls' }, 'Budget')).toBeNull()
    expect(legacyOfFile({ mimeType: 'application/pdf', filename: 'x.pdf' }, 'x.pdf')).toBeNull()
  })

  it.each([
    ['application/pdf', 'Original.pdf'],
    ['text/markdown', 'notes.md'],
    ['text/plain', 'notes.txt'],
    ['text/html; charset=utf-8', 'page.html'],
  ])(
    'a %s live version is never legacy, whatever its upload name or title says',
    (mimeType, name) => {
      for (const title of ['Renamed.doc', 'Renamed.XLS', 'Renamed.ppt']) {
        expect(legacyOfFile({ mimeType, filename: name }, title)).toBeNull()
        expect(legacyOfFile({ mimeType, filename: 'Renamed.doc' }, title)).toBeNull()
      }
      // no MIME type: an upload name of a known format is still the file's own
      expect(legacyOfFile({ mimeType: '', filename: name }, 'Renamed.doc')).toBeNull()
    },
  )

  it('rewrites only a title that ends in the legacy extension, as the server does', () => {
    expect(convertedTitle('Báo cáo ngân sách.xls', 'xls')).toBe('Báo cáo ngân sách.xlsx')
    expect(convertedTitle('REPORT.DOC', 'doc')).toBe('REPORT.docx')
    expect(convertedTitle('x.xls', 'doc')).toBe('x.xls')
    expect(convertedTitle('x.xls.bak', 'xls')).toBe('x.xls.bak')
    expect(convertedTitle('Plan', 'ppt')).toBe('Plan')
  })
})
