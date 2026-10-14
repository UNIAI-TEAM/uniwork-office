import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { settingsStrings } from '../src/renderer/src/i18n/strings-settings'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { strings } from '../src/renderer/src/strings'

/** Settings shard (i18n/settings/<lang>.ts): zh defines the key set; every UI language translates it. */

const referenceKeys = Object.keys(settingsStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')

describe('settings string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(settingsStrings).sort()).toEqual([...LANGS].sort())
  })

  it.each([...LANGS])('locale %s has exactly the zh key set, no empty values', (lang) => {
    const table = settingsStrings[lang] as Record<string, string>
    expect(Object.keys(table).sort()).toEqual(referenceKeys)
    expect(Object.entries(table).filter(([, v]) => !v.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the zh placeholders', (lang) => {
    const table = settingsStrings[lang] as Record<string, string>
    const zh = settingsStrings.zh as Record<string, string>
    expect(
      referenceKeys.filter((k) => placeholdersOf(table[k]!) !== placeholdersOf(zh[k]!)),
    ).toEqual([])
  })

  it.each([...LANGS])('locale %s names no upstream brand or competitor product', (lang) => {
    const bad = Object.values(settingsStrings[lang]).filter((v) =>
      /genspark|genoffice|github|chatgpt|\bSQLite\b|entitlement/i.test(v),
    )
    expect(bad).toEqual([])
  })

  it.each([...LANGS])(
    'locale %s: a General group title never repeats a row label under it',
    (lang) => {
      const home = strings[lang] as Record<string, string>
      const table = settingsStrings[lang] as Record<string, string>
      const rows = [
        'language',
        'theme',
        'documentTheme',
        'setAiPanelSide',
        'setAiFontSize',
        'saveLocation',
        'setAutoSave',
        'setDefaultApp',
        'setCliLink',
      ].map((k) => home[k]!.toLowerCase())
      const groups = ['setGrpAppearance', 'setGrpAiPanel', 'setGrpFiles', 'setGrpSystem']
      expect(groups.filter((g) => rows.includes(table[g]!.toLowerCase()))).toEqual([])
    },
  )

  it('does not collide with the home table or the account shard', () => {
    expect(referenceKeys.filter((k) => k in strings.zh || k in accountStrings.zh)).toEqual([])
  })
})
