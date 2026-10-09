import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { strings } from '../src/renderer/src/strings'

/**
 * Account shard (i18n/account/<lang>.ts): zh defines the key set; every UI
 * language has a real translation with the zh placeholders.
 */

const referenceKeys = Object.keys(accountStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')

describe('account string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(accountStrings).sort()).toEqual([...LANGS].sort())
  })

  it.each([...LANGS])('locale %s has exactly the zh key set, no empty values', (lang) => {
    const table = accountStrings[lang] as Record<string, string>
    expect(Object.keys(table).sort()).toEqual(referenceKeys)
    expect(Object.entries(table).filter(([, v]) => !v.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the zh placeholders', (lang) => {
    const table = accountStrings[lang] as Record<string, string>
    const zh = accountStrings.zh as Record<string, string>
    expect(
      referenceKeys.filter((k) => placeholdersOf(table[k]!) !== placeholdersOf(zh[k]!)),
    ).toEqual([])
  })

  it.each([...LANGS])(
    'locale %s has no upstream brand, repository words or internal codes',
    (lang) => {
      const bad = Object.values(accountStrings[lang]).filter((v) =>
        /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d/i.test(v),
      )
      expect(bad).toEqual([])
    },
  )

  it('does not collide with the home table keys', () => {
    expect(referenceKeys.filter((k) => k in strings.zh)).toEqual([])
  })

  it('uses natural Vietnamese and English product copy', () => {
    expect(accountStrings.vi.acctSignIn).toBe('Đăng nhập')
    expect(accountStrings.vi.acctSignOut).toBe('Đăng xuất')
    expect(accountStrings.vi.acctTitle).toBe('Tài khoản UniWork')
    expect(accountStrings.en.acctSignIn).toBe('Sign in')
    expect(accountStrings.en.acctSignOut).toBe('Sign out')
    const identical = referenceKeys.filter(
      (k) =>
        (accountStrings.en as Record<string, string>)[k] ===
        (accountStrings.vi as Record<string, string>)[k],
    )
    expect(identical).toEqual(['acctEmail'])
  })
})
