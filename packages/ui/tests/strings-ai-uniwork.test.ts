import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { aiUniworkStrings, aiUniworkText } from '../src/strings-ai-uniwork'

/**
 * Shared UniWork AI shard (ai-uniwork/<lang>.ts, U-02 closed catalogue): zh defines the key set;
 * every UI language has a real translation with the zh placeholders and keeps the provider name.
 */

const referenceKeys = Object.keys(aiUniworkStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => aiUniworkStrings[lang] as Record<string, string>

describe('ai-uniwork string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(aiUniworkStrings).sort()).toEqual([...LANGS].sort())
  })

  it.each([...LANGS])('locale %s has exactly the zh key set, no empty values', (lang) => {
    expect(Object.keys(table(lang)).sort()).toEqual(referenceKeys)
    expect(Object.entries(table(lang)).filter(([, v]) => !v.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the zh placeholders', (lang) => {
    const zh = table('zh')
    expect(
      referenceKeys.filter((k) => placeholdersOf(table(lang)[k]!) !== placeholdersOf(zh[k]!)),
    ).toEqual([])
  })

  it.each([...LANGS])('locale %s has no upstream brand or internal codes', (lang) => {
    const bad = Object.values(table(lang)).filter((v) =>
      /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d/i.test(v),
    )
    expect(bad).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the provider name untranslated', (lang) => {
    expect(table(lang).aiUniworkProvider).toBe('UniWork AI')
    expect(table(lang).aiUniworkFooterSignIn).toContain('UniWork AI')
  })

  it('uses one key per counted string: no plural-form keys and no ICU plural', () => {
    // aiRunChooseOther is a catalogue name, not a plural form: only a One/Few/Many key or an Other
    // key with a One sibling counts as a plural family
    const pluralForm = (k: string) =>
      /(One|Few|Many)$/.test(k) ||
      (k.endsWith('Other') && referenceKeys.includes(`${k.slice(0, -5)}One`))
    expect(referenceKeys.filter(pluralForm)).toEqual([])
    for (const lang of LANGS) {
      expect(Object.values(table(lang)).filter((v) => v.includes(', plural,'))).toEqual([])
    }
  })

  it('says what the catalogue says in vi and en', () => {
    expect(aiUniworkStrings.en.aiUniworkSendNeedsAck).toBe(
      'Read and confirm the notice before sending.',
    )
    expect(aiUniworkStrings.vi.aiUniworkSendNeedsAck).toBe(
      'Hãy đọc và xác nhận lời công bố trước khi gửi.',
    )
    expect(aiUniworkStrings.en.aiErrOffline).toBe(
      'You’re offline. UniWork AI doesn’t run offline and requests aren’t queued.',
    )
    expect(aiUniworkStrings.vi.aiRunOpenInApp).toBe('Mở bằng ứng dụng')
  })

  it('fills the placeholders through aiUniworkText', () => {
    expect(aiUniworkText('en', 'aiUniworkCreditsAria', { remaining: 12, limit: 50 })).toBe(
      '12 of 50 credits left',
    )
    expect(aiUniworkText('vi', 'aiErrRateLimited', { seconds: 30 })).toBe(
      'Bạn đang gửi quá nhanh. Thử lại sau 30 giây.',
    )
  })
})
