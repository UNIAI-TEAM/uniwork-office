import { describe, expect, it } from 'vitest'
import { UNIWORK_DOC_STRINGS, tUniworkDocs } from '../src/main/uniwork-docs/strings'

describe('UniWork document dialogs follow the UI language (GOA9-r2-01)', () => {
  it('Vietnamese conflict and discard dialogs name the document', () => {
    expect(tUniworkDocs('vi', 'conflictMessage', { title: 'Bảng tính.xlsx' })).toBe(
      'Một phiên bản mới hơn của “Bảng tính.xlsx” đã được lưu trên UniWork sau khi bạn mở.',
    )
    expect(tUniworkDocs('vi', 'conflictLater')).toBe('Để sau')
    expect(tUniworkDocs('vi', 'discardMessage', { title: 'Bảng tính.xlsx' })).toContain(
      '“Bảng tính.xlsx”',
    )
    expect(tUniworkDocs('vi', 'discardConfirm')).toBe('Bỏ thay đổi và mở bản mới nhất')
  })

  it('English, and English for every other UI language', () => {
    expect(tUniworkDocs('en', 'conflictTitle')).toBe('This document changed in UniWork')
    expect(tUniworkDocs('zh', 'conflictTitle')).toBe('This document changed in UniWork')
  })

  it('every key has a Vietnamese text of its own', () => {
    for (const key of Object.keys(
      UNIWORK_DOC_STRINGS.en,
    ) as (keyof typeof UNIWORK_DOC_STRINGS.en)[]) {
      expect(UNIWORK_DOC_STRINGS.vi[key]).toBeTruthy()
      expect(UNIWORK_DOC_STRINGS.vi[key]).not.toBe(UNIWORK_DOC_STRINGS.en[key])
    }
  })
})
