import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkHomeStrings } from '../src/renderer/src/i18n/strings-uniwork-home'

/**
 * UNI-1993 source open copy (shard i18n/uniwork-home): every key in every locale, vi and en
 * exactly as contract 3.5 words them, the placeholders kept, and a real translation (not the
 * English text) in the other locales.
 */

const KEYS = [
  'uhSourceOpen',
  'uhSourceOpening',
  'uhSourceOpenFailed',
  'uhSourceOpenGone',
  'uhSourceOpenOffline',
  'uhSourceOpenTooLarge',
  'uhSourceOpenRetry',
] as const

const table = (lang: string) =>
  uniworkHomeStrings[lang as (typeof LANGS)[number]] as Record<string, string>
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')

const EN: Record<(typeof KEYS)[number], string> = {
  uhSourceOpen: 'Open (view only)',
  uhSourceOpening: 'Opening {name}…',
  uhSourceOpenFailed: 'Could not open the file. Try again.',
  uhSourceOpenGone: "Couldn't open the file: it was deleted or you no longer have access.",
  uhSourceOpenOffline:
    "Couldn't open the file because UniWork can't be reached. Check your connection and try again.",
  uhSourceOpenTooLarge: 'This file is too large to open in the app. Download it instead.',
  uhSourceOpenRetry: 'Try again',
}

const VI: Record<(typeof KEYS)[number], string> = {
  uhSourceOpen: 'Mở (chỉ xem)',
  uhSourceOpening: 'Đang mở {name}…',
  uhSourceOpenFailed: 'Không mở được tệp. Thử lại.',
  uhSourceOpenGone: 'Không mở được tệp: tệp đã bị xoá hoặc bạn không còn quyền xem.',
  uhSourceOpenOffline:
    'Không mở được tệp vì không kết nối được UniWork. Kiểm tra kết nối rồi thử lại.',
  uhSourceOpenTooLarge: 'Tệp quá lớn để mở trong ứng dụng. Hãy tải xuống.',
  uhSourceOpenRetry: 'Thử lại',
}

describe('source open copy', () => {
  it('en and vi are exactly the contract wording', () => {
    for (const key of KEYS) {
      expect(table('en')[key], `en ${key}`).toBe(EN[key])
      expect(table('vi')[key], `vi ${key}`).toBe(VI[key])
    }
  })

  it.each([...LANGS])('locale %s has every key, non-empty, with the same placeholders', (lang) => {
    for (const key of KEYS) {
      const value = table(lang)[key]
      expect(value?.trim(), `${lang} ${key}`).toBeTruthy()
      expect(placeholdersOf(value!), `${lang} ${key} placeholders`).toBe(placeholdersOf(EN[key]))
    }
  })

  it.each([...LANGS].filter((lang) => lang !== 'en'))(
    'locale %s translates every sentence',
    (lang) => {
      for (const key of KEYS) {
        expect(table(lang)[key], `${lang} ${key}`).not.toBe(EN[key])
      }
    },
  )

  it.each([...LANGS])('locale %s names no git, repository or internal code', (lang) => {
    const bad = KEYS.map((key) => table(lang)[key]!).filter((v) =>
      /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d/i.test(v),
    )
    expect(bad).toEqual([])
  })
})
