import { describe, expect, it } from 'vitest'
import { DATE_LOCALES } from '../src/renderer/i18n/locale'

describe('DATE_LOCALES', () => {
  it('maps every UI language to a valid BCP-47 locale', () => {
    for (const [lang, locale] of Object.entries(DATE_LOCALES)) {
      expect(() => Intl.DateTimeFormat(locale), lang).not.toThrow()
      expect(Intl.getCanonicalLocales(locale)[0], lang).toBe(locale)
    }
    expect(DATE_LOCALES.vi).toBe('vi-VN')
  })
})
