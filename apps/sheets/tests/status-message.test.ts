import { describe, expect, it } from 'vitest'
import { strings } from '../src/renderer/i18n/strings'
import { retranslateStatus } from '../src/renderer/status-message'

describe('retranslateStatus', () => {
  it('moves the loaded-workbook status to the new language, both ways', () => {
    expect(retranslateStatus(strings.en.appFullyLoaded, 'vi')).toBe(strings.vi.appFullyLoaded)
    expect(retranslateStatus(strings.vi.appFullyLoaded, 'en')).toBe(strings.en.appFullyLoaded)
    expect(retranslateStatus(strings.ja.appReadyInitial, 'fr')).toBe(strings.fr.appReadyInitial)
  })

  it('leaves any other status text alone', () => {
    expect(retranslateStatus('Saved report.xlsx', 'vi')).toBe('Saved report.xlsx')
    expect(retranslateStatus('', 'vi')).toBe('')
  })

  it('has a Vietnamese loaded-workbook text that is not English', () => {
    expect(strings.vi.appFullyLoaded).not.toBe(strings.en.appFullyLoaded)
    expect(strings.vi.appFullyLoaded).toMatch(/sổ làm việc/)
  })
})
