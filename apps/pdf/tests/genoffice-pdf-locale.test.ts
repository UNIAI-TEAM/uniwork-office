import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { strings } from '../src/renderer/i18n/strings'
import { genofficePdfStrings } from '../src/renderer/i18n/strings-genoffice-pdf'

/**
 * Every genoffice-pdf string (and the four cert-sign keys added with the trust-status work) has
 * to be written in its own locale's script.
 *
 * Key parity cannot see a swap: each shard is `satisfies Record<keyof typeof zh, string>`, so a
 * Russian value sitting in the Italian shard satisfies the type, every parity gate and the
 * "differs from English" gate. The Russian and Italian shards were once mixed up for the comments
 * and link keys; only the script gives that away, so the script is pinned here for every key.
 */
const dicts = strings as Record<string, Record<string, string>>
const keys = [
  ...Object.keys(genofficePdfStrings.en),
  'certStoreUnsupported',
  'sigBannerUntrusted',
  'sigStatusUntrusted',
  'sigTrustRoots',
]

/** The script each non-Latin locale is written in. */
const SCRIPTS: Record<string, RegExp> = {
  ru: /\p{Script=Cyrillic}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  ko: /\p{Script=Hangul}/u,
  zh: /\p{Script=Han}/u,
  'zh-TW': /\p{Script=Han}/u,
  ar: /\p{Script=Arabic}/u,
  he: /\p{Script=Hebrew}/u,
  hi: /\p{Script=Devanagari}/u,
  th: /\p{Script=Thai}/u,
}

const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i

const withoutPlaceholders = (value: string) => value.replace(/\{\w+\}/g, '')
const isNonLatinLetter = (ch: string) => /\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)

describe('genoffice-pdf strings are in their own locale script', () => {
  it('covers the whole shard', () => {
    expect(keys.length).toBeGreaterThan(40)
  })

  it.each(Object.keys(SCRIPTS))('%s writes every key in its script', (lang) => {
    const script = SCRIPTS[lang]!
    const wrong = keys.filter((key) => !script.test(dicts[lang]![key]!))
    expect(wrong, `${lang} has no ${lang} script in: ${wrong.join(', ')}`).toEqual([])
  })

  it.each(Object.keys(SCRIPTS).filter((lang) => lang !== 'ja' && !lang.startsWith('zh')))(
    '%s carries no letters of a foreign non-Latin script',
    (lang) => {
      const script = SCRIPTS[lang]!
      const wrong = keys.filter((key) =>
        [...withoutPlaceholders(dicts[lang]![key]!)].some(
          (ch) => isNonLatinLetter(ch) && !script.test(ch),
        ),
      )
      expect(wrong, `${lang} mixes in a foreign script: ${wrong.join(', ')}`).toEqual([])
    },
  )

  const latin = [...LANGS].filter((lang) => !(lang in SCRIPTS))

  it.each(latin)(
    '%s (Latin script) holds no Cyrillic, CJK, Arabic, Hebrew, Indic or Thai',
    (lang) => {
      const wrong = keys.filter((key) =>
        [...withoutPlaceholders(dicts[lang]![key]!)].some(isNonLatinLetter),
      )
      expect(wrong, `${lang} holds non-Latin text in: ${wrong.join(', ')}`).toEqual([])
    },
  )

  it('vi keeps Vietnamese diacritics on every sentence-length value', () => {
    const wrong = keys.filter(
      (key) => dicts.vi![key]!.length > 12 && !VI_DIACRITICS.test(dicts.vi![key]!),
    )
    expect(wrong, `vi has no Vietnamese diacritics in: ${wrong.join(', ')}`).toEqual([])
  })

  it('no two unrelated Latin locales share a sentence-length value', () => {
    // es/pt and id/ms really do share some words; any other pair sharing text is a swapped block.
    const related = new Set(['es|pt', 'id|ms'])
    const shared: string[] = []
    for (const a of latin) {
      for (const b of latin) {
        if (a >= b || related.has(`${a}|${b}`)) continue
        for (const key of keys) {
          const value = dicts[a]![key]!
          if (value.length > 12 && value === dicts[b]![key]) shared.push(`${a}=${b}.${key}`)
        }
      }
    }
    expect(shared).toEqual([])
  })
})
