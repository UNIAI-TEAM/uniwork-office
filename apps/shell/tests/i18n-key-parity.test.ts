import { describe, expect, it } from 'vitest'
import { strings } from '../src/renderer/src/strings'
import { uniworkHomeStrings } from '../src/renderer/src/i18n/strings-uniwork-home'

/**
 * zh defines the key set, every sibling locale must cover it. The LangDicts
 * constraint at the `createI18n(strings)` call already turns a missing key
 * into a compile error, but only while the object flows into that call
 * unmarked — and a type error names neither the locale nor the key. These
 * runtime checks read the shipped table directly, in the style of
 * apps/docs/tests/translate-i18n-completeness.test.ts, so a drifting table
 * fails CI with a message that says exactly which keys moved.
 */

const LOCALES = Object.keys(strings) as Array<keyof typeof strings>

describe('shell strings — key parity', () => {
  it('every locale carries exactly the zh key set', () => {
    const reference = Object.keys(strings.zh).sort()
    expect(reference.length, 'zh defines the key set').toBeGreaterThan(0)
    for (const lang of LOCALES) {
      const keys = Object.keys(strings[lang]).sort()
      const missing = reference.filter((key) => !keys.includes(key))
      const extra = keys.filter((key) => !reference.includes(key))
      expect(
        missing,
        `${lang} is missing ${missing.length} key(s): ${missing.slice(0, 8).join(', ')}`,
      ).toEqual([])
      expect(
        extra,
        `${lang} carries ${extra.length} key(s) zh does not have: ${extra.slice(0, 8).join(', ')}`,
      ).toEqual([])
    }
  })

  it('no locale ships an empty label', () => {
    for (const lang of LOCALES) {
      for (const [key, value] of Object.entries(strings[lang])) {
        expect(value.length, `${lang}.${key} is an empty string`).toBeGreaterThan(0)
      }
    }
  })

  it('names the product "Google Drive" in every locale, never a localized name', () => {
    // the brand stays untranslated (UNI-2197): no "Google ドライブ", "Dysk Google", "Google Диск", ...
    const localized =
      /Google[\s-]?(ドライブ|드라이브|Диск|Unidad|Laufwerk|Disque|Unità|Schijf|ไดรฟ์|डिस्क|דרייב|云端硬盘|雲端硬碟)|Dysk(iem|u|iu)?\s+Google|Диск(е|а|у|ом)?\s+Google|גוגל\s+דרייב|谷歌/
    for (const [lang, table] of Object.entries(uniworkHomeStrings) as Array<
      [string, Record<string, string>]
    >) {
      expect(table.uhNavGoogleDrive, lang).toBe('Google Drive')
      for (const [key, value] of Object.entries(table)) {
        if (!/^(uhDrive|uhNavDrive|uhNavGoogleDrive)/.test(key)) continue
        expect(value, `${lang}.${key} localizes the Google Drive name`).not.toMatch(localized)
      }
    }
  })
})
