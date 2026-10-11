import { describe, expect, it } from 'vitest'
import { strings } from '../src/renderer/i18n/strings'
import { retranslateStatus } from '../src/renderer/status-message'

describe('retranslateStatus', () => {
  it('moves the loaded-workbook status to the new language, both ways', () => {
    expect(retranslateStatus(strings.en.appFullyLoaded, 'vi')).toBe(strings.vi.appFullyLoaded)
    expect(retranslateStatus(strings.vi.appFullyLoaded, 'en')).toBe(strings.en.appFullyLoaded)
    expect(retranslateStatus(strings.ja.appReadyInitial, 'fr')).toBe(strings.fr.appReadyInitial)
  })

  it('moves the streaming-rows status to the new language and keeps its name and row count', () => {
    const en = strings.en.appStreamingRows
    expect(en).toContain('{name}')
    const english = 'Streaming GO-A9 Bảng tính.xlsx: 6 rows available.'
    expect(retranslateStatus(english, 'vi')).toBe(
      strings.vi.appStreamingRows.replace('{name}', 'GO-A9 Bảng tính.xlsx').replace('{rows}', '6'),
    )
    // the chunked form carries "loaded / total" in the rows slot
    const chunked = 'Streaming big.xlsx: 1,000 / 50,000 rows available.'
    expect(retranslateStatus(chunked, 'de')).toBe(
      strings.de.appStreamingRows.replace('{name}', 'big.xlsx').replace('{rows}', '1,000 / 50,000'),
    )
    const vi = retranslateStatus(english, 'vi')
    expect(retranslateStatus(vi, 'en')).toBe(english)
    expect(vi).not.toMatch(/Streaming|available/)
  })

  it('leaves any other status text alone', () => {
    expect(retranslateStatus('Saved report.xlsx', 'vi')).toBe('Saved report.xlsx')
    expect(retranslateStatus('', 'vi')).toBe('')
    expect(retranslateStatus('Streaming notes', 'vi')).toBe('Streaming notes')
  })

  it('has a Vietnamese loaded-workbook text that is not English', () => {
    expect(strings.vi.appFullyLoaded).not.toBe(strings.en.appFullyLoaded)
    expect(strings.vi.appFullyLoaded).toMatch(/sổ làm việc/)
  })
})
