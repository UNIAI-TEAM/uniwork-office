import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkDocListStrings } from '../src/renderer/src/i18n/strings-uniwork-doclist'
import { strings } from '../src/renderer/src/strings'

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

// the 17 locales whose dl* shard is English until the translation pass; zh, zh-TW, vi and en are real copy
const UNTRANSLATED_LANGS = LANGS.filter((l) => !['zh', 'zh-TW', 'vi', 'en'].includes(l))

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

  it('ja keeps the translations the local Home list already had (no English regression)', () => {
    const ja = table('ja')
    expect(ja.dlColName).toBe('名前')
    expect(ja.dlColUpdated).toBe('更新日時')
    expect(ja.dlColSize).toBe('サイズ')
    expect(ja.dlActOpen).toBe('開く')
    expect(ja.dlActRename).toBe('名前の変更')
    expect(ja.dlActDuplicate).toBe('複製を作成')
  })

  it.each(UNTRANSLATED_LANGS)(
    'locale %s reuses the home-screen words for the keys it replaces',
    (lang) => {
      const home = (strings as Record<string, Record<string, string>>)[lang]!
      const dl = table(lang)
      expect({
        dlColName: dl.dlColName,
        dlColUpdated: dl.dlColUpdated,
        dlColSize: dl.dlColSize,
        dlActOpen: dl.dlActOpen,
        dlActRename: dl.dlActRename,
        dlActDuplicate: dl.dlActDuplicate,
      }).toEqual({
        dlColName: home.colName,
        dlColUpdated: home.colModified,
        dlColSize: home.colSize,
        dlActOpen: home.open,
        dlActRename: home.rename,
        dlActDuplicate: home.duplicate,
      })
    },
  )

  it('never says "Hạn chế" for the private pill, in any locale', () => {
    for (const lang of LANGS)
      expect(table(lang).dlAccessRestricted).not.toMatch(/Hạn chế|Restricted/)
  })

  it('names no internal code, git or GitHub word in any locale', () => {
    const all = LANGS.flatMap((l) => Object.values(table(l)))
    expect(all.filter((v) => /\b(UNI|GO)-\d+\b|\bgit(hub)?\b/i.test(v))).toEqual([])
  })
})
