import { describe, expect, it } from 'vitest'
import { createI18n, LANGS } from '@genoffice/i18n'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { cloudStrings } from '../src/renderer/src/i18n/strings-cloud'
import { strings } from '../src/renderer/src/strings'

/**
 * Desktop sync shard (i18n/sync/<lang>.ts, U-02 closed catalogue): zh defines the key set; every
 * UI language has a real translation with the zh placeholders; counted strings are one key whose
 * sentence holds for any number (no plural keys, no ICU).
 */

const referenceKeys = Object.keys(syncStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => syncStrings[lang] as Record<string, string>

describe('sync string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(syncStrings).sort()).toEqual([...LANGS].sort())
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

  it.each([...LANGS])(
    'locale %s has no upstream brand, repository words or internal codes',
    (lang) => {
      const bad = Object.values(table(lang)).filter((v) =>
        /genspark|genoffice|github|\bgit\b|filesystem|fileservice|documents api|\bUNI-\d|\bGO-[A-Z]?\d/i.test(
          v,
        ),
      )
      expect(bad).toEqual([])
    },
  )

  it('uses one key per counted string: no plural-form keys and no ICU plural', () => {
    expect(referenceKeys.filter((k) => /(One|Few|Many|Other)$/.test(k))).toEqual([])
    for (const lang of LANGS) {
      expect(Object.values(table(lang)).filter((v) => v.includes(', plural,'))).toEqual([])
    }
  })

  it('does not collide with the home, account, cloud or uniwork-documents keys', () => {
    expect(
      referenceKeys.filter(
        (k) =>
          k in strings.zh ||
          k in accountStrings.zh ||
          k in cloudStrings.zh ||
          k in uniworkDocumentStrings.zh,
      ),
    ).toEqual([])
  })

  it('leaves the newer-store lock copy to the uniwork-documents shard', () => {
    expect(referenceKeys).not.toContain('uwLockNewerStoreTitle')
    expect(referenceKeys).not.toContain('uwLockNewerStore')
  })

  it('says what the catalogue says in vi and en', () => {
    expect(syncStrings.en.uwChipQueued).toBe('Save queued — not on UniWork yet')
    expect(syncStrings.vi.uwChipQueued).toBe('Đã xếp hàng lưu — chưa lưu lên UniWork')
    expect(syncStrings.en.uwSyncTabCount).toBe('{label}: {count}')
    expect(syncStrings.vi.uwSyncTabCount).toBe('{label}, {count} mục')
    expect(syncStrings.en.uwConflictOverwrite).toBe('Overwrite…')
    expect(syncStrings.vi.uwRemoteUpdatedNoRev).toBe(
      'Đã cập nhật lên phiên bản mới nhất trên UniWork.',
    )
    expect(syncStrings.en.uwRemoteUpdatedNoRev).toBe('Updated to the latest version on UniWork.')
  })

  it('does not show revision jargon in vi/en copy', () => {
    for (const lang of ['vi', 'en'] as const) {
      expect(
        Object.values(table(lang)).filter((v) => /revision|base_revision|\bidempot/i.test(v)),
      ).toEqual([])
    }
  })

  describe('counted strings read correctly for 1, 2 and 5', () => {
    const t = createI18n(syncStrings)
    const cases = [
      ['uwSyncTabCount', { label: 'Queue' }],
      ['uwSyncSignedOut', {}],
      ['uwRowReconcileStuck', {}],
      ['uwSignOutBody', {}],
    ] as const
    for (const lang of ['vi', 'en', 'ru', 'pl'] as const) {
      for (const [key, extra] of cases) {
        it.each([1, 2, 5])(`${lang} ${key} with %i`, (count) => {
          const out = t(lang, key, { ...extra, count })
          expect(out).toContain(String(count))
          expect(out).not.toMatch(/\{[a-zA-Z0-9]+\}/)
        })
      }
    }
  })
})
