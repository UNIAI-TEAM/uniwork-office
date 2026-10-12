import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { webStrings, webText } from './strings-web'

/**
 * Shared web-frame shard (i18n/web/<lang>.ts): zh defines the key set; every UI language has a
 * real translation with the zh placeholders. The uw* conflict and new-version keys come from the
 * U-02 closed catalogue.
 */

const referenceKeys = Object.keys(webStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => webStrings[lang] as Record<string, string>

describe('web string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(webStrings).sort()).toEqual([...LANGS].sort())
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
    expect(webStrings.en.webConflictBodySafe).toBe(
      'Your changes aren’t on UniWork yet and are kept in this browser until you sign out.',
    )
    expect(webStrings.en.uwConflictMineFileSuffix).toBe('(my version)')
    expect(webStrings.vi.uwConflictMineFileSuffix).toBe('(bản của tôi)')
    expect(webStrings.en.uwRemoteUpdatedNoRev).toBe('Updated to the latest version on UniWork.')
  })

  it('fills the placeholders through webText', () => {
    expect(webText('en', 'uwRemoteUpdated', { n: 7, author: 'An', time: '15:20' })).toBe(
      'Updated to version 7, saved by An at 15:20.',
    )
    expect(
      webText('vi', 'uwRemoteOrgBlockedWeb', { reason: webText('vi', 'uwReasonSuspended') }),
    ).toBe(
      'Không lưu được: tổ chức đang bị tạm ngưng. Thay đổi chưa lưu được giữ trong trình duyệt này cho tới khi bạn đăng xuất.',
    )
  })
})
