import { describe, expect, it } from 'vitest'
import { strings } from '../src/renderer/i18n/strings'

const KEY = 'ribbonAutoSaveUniworkTip'
const EN = 'AutoSave is off for UniWork documents. Use Save to save a new version.'

type Dict = Record<string, string>
const dicts = strings as unknown as Record<string, Dict>

describe('AutoSave tooltip of a UniWork document (slides)', () => {
  it('is English in en and Vietnamese in vi', () => {
    expect(dicts.en![KEY]).toBe(EN)
    expect(dicts.vi![KEY]).toBe(
      'Tự động lưu đã tắt cho tài liệu UniWork. Hãy dùng Lưu để lưu phiên bản mới.',
    )
  })

  it('is really translated in every shipped locale, not the English fallback', () => {
    const untranslated = Object.entries(dicts)
      .filter(([lang]) => lang !== 'en')
      .filter(([, dict]) => !dict[KEY] || dict[KEY] === EN)
      .map(([lang]) => lang)
    expect(untranslated).toEqual([])
  })

  it('keeps the product name in every locale', () => {
    for (const [lang, dict] of Object.entries(dicts)) {
      expect(dict[KEY], lang).toContain('UniWork')
    }
  })
})
