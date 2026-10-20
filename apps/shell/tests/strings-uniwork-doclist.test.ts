import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkDocListStrings } from '../src/renderer/src/i18n/strings-uniwork-doclist'

/**
 * The uniwork-doclist shard (i18n/uniwork-doclist/<lang>.ts): zh defines the
 * key set; 21 locales with the zh placeholders; vi + en are the glossary copy
 * the web shares (documents.list.*); other locales carry English for now;
 * no internal codes or git words anywhere.
 */

const referenceKeys = Object.keys(uniworkDocListStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) =>
  uniworkDocListStrings[lang] as Record<string, string>

describe('uniwork doclist string shard', () => {
  it('covers every UI language (21)', () => {
    expect(Object.keys(uniworkDocListStrings).sort()).toEqual([...LANGS].sort())
    expect(LANGS).toHaveLength(21)
  })

  it('keys are prefixed dl', () => {
    expect(referenceKeys.filter((k) => !k.startsWith('dl'))).toEqual([])
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

  it('vi and en carry the glossary words', () => {
    const vi = table('vi')
    const en = table('en')
    expect(vi.dlAccessRestricted).toBe('Riêng tư')
    expect(en.dlAccessRestricted).toBe('Private')
    expect(vi.dlAccessShared).toBe('Được chia sẻ')
    expect(en.dlAccessShared).toBe('Shared')
    expect(vi.dlAccessOwner).toBe('Chủ sở hữu')
    expect(vi.dlAccessYou).toBe('Bạn: {level}')
    expect([vi.dlLevelView, vi.dlLevelComment, vi.dlLevelEdit, vi.dlLevelManage]).toEqual([
      'Xem',
      'Bình luận',
      'Sửa',
      'Quản lý',
    ])
    expect(vi.dlColEditor).toBe('Người sửa gần nhất')
    expect(vi.dlDaysLeftOther).toBe('Còn {n} ngày')
    expect(en.dlDaysLeftOne).toBe('{n} day left')
    expect(en.dlDaysLeftOther).toBe('{n} days left')
  })

  it('never says "Hạn chế" for the private pill, in any locale', () => {
    for (const lang of LANGS)
      expect(table(lang).dlAccessRestricted).not.toMatch(/Hạn chế|Restricted/)
  })

  it('names no internal code, git or GitHub word in any locale', () => {
    const all = LANGS.flatMap((l) => Object.values(table(l)))
    expect(all.filter((v) => /\b(UNI|GO)-\d+\b|\bgit(hub)?\b/i.test(v))).toEqual([])
  })
})
