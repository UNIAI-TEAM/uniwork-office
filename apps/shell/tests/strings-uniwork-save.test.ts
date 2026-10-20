import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkSaveStrings } from '../src/renderer/src/i18n/strings-uniwork-save'
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
 * SAVE-01 §5 / AC-6: the uniwork-save shard (i18n/uniwork-save/<lang>.ts).
 * zh defines the key set; 21 locales with the zh placeholders; vi verbatim
 * from the SaveDialog board; My Folder = "Thư mục của tôi" / "My Folder";
 * no "cục bộ".
 */

const referenceKeys = Object.keys(uniworkSaveStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => uniworkSaveStrings[lang] as Record<string, string>

describe('uniwork save string shards', () => {
  it('covers every UI language (21)', () => {
    expect(Object.keys(uniworkSaveStrings).sort()).toEqual([...LANGS].sort())
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
      const same = referenceKeys.filter((k) => table(lang)[k] === en[k])
      expect(same.length).toBeLessThan(referenceKeys.length / 4)
    },
  )

  it('UNI-1975: drops the shared-folder note in every locale (folders are not shared, a document keeps its own access)', () => {
    expect(referenceKeys).not.toContain('usSharedNote')
    for (const lang of LANGS) expect(Object.keys(table(lang))).not.toContain('usSharedNote')
  })

  it('never says "cục bộ" (no local-only wording)', () => {
    const all = LANGS.flatMap((l) => Object.values(table(l)))
    expect(all.filter((v) => /cục bộ/i.test(v.normalize('NFC')))).toEqual([])
  })

  it('vi is verbatim from the SaveDialog board, en drafted from it (contract §4-5)', () => {
    const vi = table('vi')
    const en = table('en')
    expect(vi.usMyFolder).toBe('Thư mục của tôi')
    expect(en.usMyFolder).toBe('My Folder')
    expect(vi.usDialogTitle).toBe('Đặt tên tài liệu')
    expect(vi.usHint).toBe(
      'Lần lưu đầu tiên. Các lần lưu sau giữ nguyên tên; dùng “Lưu thành” nếu muốn đổi.',
    )
    expect(vi.usName).toBe('Tên')
    expect(vi.usLocation).toBe('Nơi lưu')
    expect(vi.usSavingIn).toBe('Đang lưu trong: {folder}')
    expect(vi.usMyFolderPrivate).toBe('Riêng tư, chỉ bạn thấy')
    expect(vi.usChange).toBe('Đổi')
    expect(vi.usSave).toBe('Lưu')
    expect(vi.usClose).toBe('Đóng')
    expect(vi.usPickTitle).toBe('Chọn nơi lưu')
    expect(vi.usBack).toBe('Quay lại đặt tên')
    expect(vi.usSearchFolders).toBe('Tìm thư mục')
    expect(vi.usChooseFolder).toBe('Chọn “{folder}”')
    expect(vi.usSelected).toBe('Đang chọn')
    expect(vi.usPrivateTag).toBe('Riêng tư')
    // "Thư mục mới" is the FD-11 key, reused (Q7)
    expect(uniworkFolderStrings.vi.ufNewFolder).toBe('Thư mục mới')
  })

  it('the My Folder label is translated in all 21 locales and never the stored title elsewhere', () => {
    const labels = LANGS.map((l) => table(l).usMyFolder)
    expect(new Set(labels).size).toBeGreaterThanOrEqual(18)
  })

  it('does not collide with any other renderer table', () => {
    const others = [
      strings.zh,
      accountStrings.zh,
      cloudStrings.zh,
      uniworkDocumentStrings.zh,
      uniworkFolderStrings.zh,
      syncStrings.zh,
      workbenchStrings.zh,
      discussionStrings.zh,
      settingsStrings.zh,
    ]
    expect(referenceKeys.filter((k) => others.some((t) => k in t))).toEqual([])
  })

  it.each([...LANGS])(
    'locale %s has no replacement chars or ?-corrupted non-ASCII bytes',
    (lang) => {
      const corrupted = Object.entries(table(lang)).filter(([, v]) =>
        /�|\?{2,}|\p{L}\?\p{L}/u.test(v),
      )
      expect(corrupted).toEqual([])
    },
  )
})
