import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { cloudStrings } from '../src/renderer/src/i18n/strings-cloud'

/**
 * Desktop cloud shard (i18n/cloud/<lang>.ts): zh defines the key set; every UI language has a real
 * translation with the zh placeholders and no upstream brand. Runtime twin of the compile-time
 * satisfies check, as the U-02 card asks for the cloud, sync and web shards.
 */

const referenceKeys = Object.keys(cloudStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => cloudStrings[lang] as Record<string, string>

describe('cloud string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(cloudStrings).sort()).toEqual([...LANGS].sort())
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
})
