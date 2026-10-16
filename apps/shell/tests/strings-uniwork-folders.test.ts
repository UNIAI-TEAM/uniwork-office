import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { cloudStrings } from '../src/renderer/src/i18n/strings-cloud'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { workbenchStrings } from '../src/renderer/src/i18n/strings-workbench'
import { discussionStrings } from '../src/renderer/src/i18n/strings-discussion'
import { settingsStrings } from '../src/renderer/src/i18n/strings-settings'
import { strings } from '../src/renderer/src/strings'

/**
 * FD-11 §5: the uniwork-folders shard (i18n/uniwork-folders/<lang>.ts). zh
 * defines the key set; every UI language has a real translation with the zh
 * placeholders; vi/en use the web's wording; no "cục bộ" anywhere.
 */

const referenceKeys = Object.keys(uniworkFolderStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => uniworkFolderStrings[lang] as Record<string, string>

describe('uniwork folders string shards', () => {
  it('covers every UI language (21)', () => {
    expect(Object.keys(uniworkFolderStrings).sort()).toEqual([...LANGS].sort())
    expect(LANGS).toHaveLength(21)
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

  it.each([...LANGS.filter((l) => l !== 'en')])(
    'locale %s is translated, not the English copy',
    (lang) => {
      const en = table('en')
      // the brand and short shared words may coincide; most of the table must differ
      const same = referenceKeys.filter((k) => table(lang)[k] === en[k])
      expect(same.length).toBeLessThan(referenceKeys.length / 4)
    },
  )

  it('never says "cục bộ" (no local-only wording)', () => {
    const all = LANGS.flatMap((l) => Object.values(table(l)))
    expect(all.filter((v) => /cục bộ/i.test(v))).toEqual([])
  })

  it('uses the web wording for vi and en (contract §5)', () => {
    const vi = table('vi')
    const en = table('en')
    expect(vi.ufNewFolder).toBe('Thư mục mới')
    expect(vi.ufMoveTo).toBe('Di chuyển tới…')
    expect(vi.ufMoved).toBe('Đã chuyển tới {folder}')
    expect(vi.ufMovedRenamed).toBe('Đã chuyển và đổi tên thành {title}')
    expect(vi.ufNameTaken).toBe('Đã có thư mục tên này ở đây. Hãy đặt tên khác.')
    expect(vi.ufFolderGone).toBe('Thư mục này không còn ở đây.')
    expect(vi.ufLocationRoot).toBe('UniWork (gốc)')
    expect(en.ufNameTaken).toBe('A folder with this name already exists here. Choose another name.')
    expect(en.ufTooDeep).toBe('The document tree is at most {max} levels deep.')
    expect(en.ufNoPermission).toBe("You don't have permission to change this folder.")
  })

  it('does not collide with any other renderer table', () => {
    const others = [
      strings.zh,
      accountStrings.zh,
      cloudStrings.zh,
      uniworkDocumentStrings.zh,
      syncStrings.zh,
      workbenchStrings.zh,
      discussionStrings.zh,
      settingsStrings.zh,
    ]
    expect(referenceKeys.filter((k) => others.some((t) => k in t))).toEqual([])
  })
})
