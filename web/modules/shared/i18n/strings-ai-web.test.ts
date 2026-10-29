import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { aiWebStrings } from './strings-ai-web'

/**
 * Shared web AI shard (i18n/ai-web/<lang>.ts): zh defines the key set; every UI language has a
 * real translation with the zh placeholders. aiErrWorkbookTooLarge comes from the U-02 closed
 * catalogue.
 */

const referenceKeys = Object.keys(aiWebStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => aiWebStrings[lang] as Record<string, string>

describe('ai-web string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(aiWebStrings).sort()).toEqual([...LANGS].sort())
  })

  it('holds the failure states and the handoff text only: no key settings, provider or model strings (UNI-2289)', () => {
    expect(referenceKeys).toEqual(
      [
        'aiWebClose',
        'aiWebStateCreditsTitle',
        'aiWebStateCreditsBody',
        'aiWebStateEntitlementTitle',
        'aiWebStateEntitlementBody',
        'aiWebStateRateTitle',
        'aiWebStateRateBody',
        'aiWebStateRateBodyNow',
        'aiWebStateUnreachableTitle',
        'aiWebStateUnreachableBody',
        'aiWebStateCloudTitle',
        'aiWebStateCloudBody',
        'aiWebStateOutageTitle',
        'aiWebStateOutageBody',
        'aiWebStateSessionTitle',
        'aiWebStateSessionBody',
        'aiWebStateRefusedTitle',
        'aiWebStateRefusedBody',
        'aiWebStateUnknownTitle',
        'aiWebStateUnknownBody',
        'aiErrWorkbookTooLarge',
        'aiHandoffContinue',
      ].sort(),
    )
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

  it('uses one key per counted string: no plural-form keys and no ICU plural', () => {
    expect(referenceKeys.filter((k) => /(One|Few|Many|Other)$/.test(k))).toEqual([])
    for (const lang of LANGS) {
      expect(Object.values(table(lang)).filter((v) => v.includes(', plural,'))).toEqual([])
    }
  })

  it('says what the catalogue says in vi and en', () => {
    expect(aiWebStrings.en.aiErrWorkbookTooLarge).toBe(
      'This workbook is too large for AI on the web. Open it in the UniWork Office app.',
    )
    expect(aiWebStrings.vi.aiErrWorkbookTooLarge).toBe(
      'Bảng tính này quá lớn để AI xử lý trên web. Mở bằng ứng dụng UniWork Office.',
    )
  })
})
