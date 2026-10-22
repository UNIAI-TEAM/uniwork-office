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

// UNI-2078 slice 1: the copy dialog's copy (web documents.copy.*, vi/en verbatim)
describe('the copy dialog strings (UNI-2078)', () => {
  const COPY_KEYS = [
    'dlCopyTitle',
    'dlCopyDescription',
    'dlCopyTitleLabel',
    'dlCopyTitlePlaceholder',
    'dlCopyConsentLabel',
    'dlCopyConsentHint',
    'dlCopySubmit',
    'dlCopySubmitting',
    'dlCopyFailed',
    'dlCopyDone',
    'dlCopyUnavailable',
  ]

  it.each([...LANGS])('locale %s has every copy key with copy', (lang) => {
    for (const key of COPY_KEYS) expect(table(lang)[key]?.trim(), `${lang}.${key}`).toBeTruthy()
  })

  it('the placeholder carries {title} and done carries {title} in every locale', () => {
    for (const lang of LANGS) {
      expect(table(lang).dlCopyTitlePlaceholder).toContain('{title}')
      expect(table(lang).dlCopyDone).toContain('{title}')
    }
  })

  it('vi is the web wording, verbatim', () => {
    const vi = table('vi')
    expect(vi.dlCopyTitle).toBe('Tạo bản sao')
    expect(vi.dlCopyDescription).toBe(
      'Bản sao là tài liệu mới, giữ nguyên quyền và nguồn gốc của tài liệu này; bytes dùng chung nên không tính dung lượng lần hai.',
    )
    expect(vi.dlCopyTitleLabel).toBe('Tên bản sao')
    expect(vi.dlCopyTitlePlaceholder).toBe('{title} (bản sao)')
    expect(vi.dlCopyConsentLabel).toBe('Tôi hiểu bản sao giữ nguyên quyền của nguồn')
    expect(vi.dlCopyConsentHint).toBe(
      'Bản sao không mở rộng quyền cho ai và không sửa tài liệu gốc.',
    )
    expect(vi.dlCopySubmit).toBe('Tạo bản sao')
    expect(vi.dlCopySubmitting).toBe('Đang tạo bản sao…')
    expect(vi.dlCopyFailed).toBe('Không tạo được bản sao. Chưa có gì thay đổi.')
    expect(vi.dlCopyDone).toBe('Đã tạo bản sao "{title}"')
    expect(vi.dlCopyUnavailable).toBe('Bản triển khai này chưa có chức năng tạo bản sao.')
  })

  it('en is the web wording, verbatim', () => {
    const en = table('en')
    expect(en.dlCopyTitle).toBe('Create a copy')
    expect(en.dlCopyDescription).toBe(
      "The copy is a new document that keeps this document's access and provenance; the bytes are shared, so storage is counted once.",
    )
    expect(en.dlCopyTitleLabel).toBe('Copy title')
    expect(en.dlCopyTitlePlaceholder).toBe('{title} (copy)')
    expect(en.dlCopyConsentLabel).toBe("I understand the copy keeps the source's access")
    expect(en.dlCopyConsentHint).toBe("The copy widens nobody's access and never edits the source.")
    expect(en.dlCopySubmit).toBe('Create copy')
    expect(en.dlCopySubmitting).toBe('Creating the copy…')
    expect(en.dlCopyFailed).toBe('Could not create the copy. Nothing changed.')
    expect(en.dlCopyDone).toBe('Created the copy "{title}"')
    expect(en.dlCopyUnavailable).toBe('This deployment does not have the copy feature yet.')
  })

  it('the other 19 locales are translated, not an English copy', () => {
    const en = table('en')
    const same = LANGS.filter((l) => l !== 'en').filter(
      (l) => table(l).dlCopyDescription === en.dlCopyDescription,
    )
    expect(same).toEqual([])
  })
})

// UNI-2078 slice 2: Delete forever (web documents.trash.purge*, documents.list.bulk.*purge*)
describe('the delete-forever strings (UNI-2078)', () => {
  const PURGE_KEYS = [
    'dlPurgeTitle',
    'dlPurgeDescription',
    'dlPurgeFolderDescription',
    'dlPurgeSubmit',
    'dlPurgeSubmitting',
    'dlPurgeDone',
    'dlPurgeFailed',
    'dlBulkPurgeTitleOne',
    'dlBulkPurgeTitleOther',
    'dlBulkPurgeDescription',
    'dlBulkDonePurge',
  ]

  it.each([...LANGS])('locale %s has every purge key with copy', (lang) => {
    for (const key of PURGE_KEYS) expect(table(lang)[key]?.trim(), `${lang}.${key}`).toBeTruthy()
  })

  it('the placeholders are the same in every locale', () => {
    const vars: Record<string, string[]> = {
      dlPurgeTitle: ['{title}'],
      dlPurgeDone: ['{title}'],
      dlBulkPurgeTitleOne: ['{n}'],
      dlBulkPurgeTitleOther: ['{n}'],
      dlBulkDonePurge: ['{ok}', '{total}'],
    }
    for (const lang of LANGS) {
      for (const [key, want] of Object.entries(vars)) {
        expect(placeholdersOf(table(lang)[key]!), `${lang}.${key}`).toBe(want.sort().join(','))
      }
      for (const key of PURGE_KEYS.filter((k) => !(k in vars))) {
        expect(placeholdersOf(table(lang)[key]!), `${lang}.${key}`).toBe('')
      }
    }
  })

  it('vi is the web wording, verbatim', () => {
    const vi = table('vi')
    expect(vi.dlPurgeTitle).toBe('Xóa vĩnh viễn {title}?')
    expect(vi.dlPurgeDescription).toBe('Mục này sẽ bị xóa vĩnh viễn và không thể hoàn tác.')
    expect(vi.dlPurgeFolderDescription).toBe(
      'Thư mục này sẽ bị xóa vĩnh viễn và không thể hoàn tác. Mục con bạn không quản lý vẫn ở lại thùng rác.',
    )
    expect(vi.dlPurgeSubmit).toBe('Xóa vĩnh viễn')
    expect(vi.dlPurgeSubmitting).toBe('Đang xóa vĩnh viễn…')
    expect(vi.dlPurgeDone).toBe('Đã xóa vĩnh viễn {title}')
    expect(vi.dlPurgeFailed).toBe('Không xóa được. Chưa có gì thay đổi.')
    expect(vi.dlBulkPurgeTitleOne).toBe('Xóa vĩnh viễn {n} tài liệu?')
    expect(vi.dlBulkPurgeTitleOther).toBe('Xóa vĩnh viễn {n} tài liệu?')
    expect(vi.dlBulkPurgeDescription).toBe(
      'Không thể hoàn tác. Mục bạn không có quyền sẽ được bỏ qua.',
    )
    expect(vi.dlBulkDonePurge).toBe('Đã xóa vĩnh viễn {ok}/{total} tài liệu')
  })

  it('en is the web wording, verbatim', () => {
    const en = table('en')
    expect(en.dlPurgeTitle).toBe('Delete {title} forever?')
    expect(en.dlPurgeDescription).toBe(
      'This item will be permanently deleted and cannot be undone.',
    )
    expect(en.dlPurgeFolderDescription).toBe(
      'This folder will be permanently deleted and cannot be undone. Items inside it that you do not manage stay in the trash.',
    )
    expect(en.dlPurgeSubmit).toBe('Delete forever')
    expect(en.dlPurgeSubmitting).toBe('Deleting forever…')
    expect(en.dlPurgeDone).toBe('{title} deleted forever')
    expect(en.dlPurgeFailed).toBe('Could not delete. Nothing changed.')
    expect(en.dlBulkPurgeTitleOne).toBe('Delete {n} document forever?')
    expect(en.dlBulkPurgeTitleOther).toBe('Delete {n} documents forever?')
    expect(en.dlBulkPurgeDescription).toBe(
      'This cannot be undone. Items you cannot manage are skipped.',
    )
    expect(en.dlBulkDonePurge).toBe('Deleted {ok}/{total} documents forever')
  })

  it('the other 19 locales are translated, not an English copy', () => {
    const en = table('en')
    for (const key of [
      'dlPurgeDescription',
      'dlPurgeFolderDescription',
      'dlBulkPurgeDescription',
    ]) {
      const same = LANGS.filter((l) => l !== 'en').filter((l) => table(l)[key] === en[key])
      expect(same, key).toEqual([])
    }
  })
})

describe('bulk Move strings (UNI-2078 slice 3)', () => {
  const KEYS = [
    'dlBulkMoveTitleOne',
    'dlBulkMoveTitleOther',
    'dlBulkMoveDescription',
    'dlBulkDoneMove',
  ] as const

  it.each([...LANGS])('locale %s has the 4 keys', (lang) => {
    for (const key of KEYS) expect(table(lang)[key]?.trim(), `${lang}.${key}`).toBeTruthy()
  })

  it('vi is the web wording, verbatim ({{x}} -> {x})', () => {
    const vi = table('vi')
    expect(vi.dlBulkMoveTitleOne).toBe('Di chuyển {count} tài liệu')
    expect(vi.dlBulkMoveTitleOther).toBe('Di chuyển {count} tài liệu')
    expect(vi.dlBulkMoveDescription).toBe('Chọn thư mục đích cho các tài liệu đã chọn.')
    expect(vi.dlBulkDoneMove).toBe('Đã di chuyển {ok}/{total} tài liệu')
  })

  it('en is the web wording, verbatim', () => {
    const en = table('en')
    expect(en.dlBulkMoveTitleOne).toBe('Move {count} document')
    expect(en.dlBulkMoveTitleOther).toBe('Move {count} documents')
    expect(en.dlBulkMoveDescription).toBe('Choose the folder the selected documents move to.')
    expect(en.dlBulkDoneMove).toBe('Moved {ok}/{total} documents')
  })

  it('the title keys carry {count}, the done key {ok} and {total}', () => {
    for (const lang of LANGS) {
      expect(table(lang).dlBulkMoveTitleOne, lang).toContain('{count}')
      expect(table(lang).dlBulkMoveTitleOther, lang).toContain('{count}')
      expect(table(lang).dlBulkDoneMove, lang).toContain('{ok}')
      expect(table(lang).dlBulkDoneMove, lang).toContain('{total}')
    }
  })

  it('the other 19 locales are translated, not an English copy', () => {
    const en = table('en')
    for (const key of KEYS) {
      const same = LANGS.filter((l) => l !== 'en').filter((l) => table(l)[key] === en[key])
      expect(same, key).toEqual([])
    }
  })
})
