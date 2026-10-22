import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkVersionStrings } from '../src/renderer/src/i18n/strings-uniwork-versions'
import { strings } from '../src/renderer/src/strings'

/**
 * The uniwork-versions shard (i18n/uniwork-versions/<lang>.ts): zh defines the key set; 21
 * locales with the zh placeholders; vi + en are the web's own copy (documents.versions.*,
 * documents.file.reason_*, documents.upload.document_locked*), the others are translated.
 */

const referenceKeys = Object.keys(uniworkVersionStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) =>
  uniworkVersionStrings[lang] as Record<string, string>

describe('uniwork versions string shard', () => {
  it('covers every UI language (21)', () => {
    expect(Object.keys(uniworkVersionStrings).sort()).toEqual([...LANGS].sort())
    expect(LANGS).toHaveLength(21)
  })

  it('keys are prefixed vhs and never collide with another shard', () => {
    expect(referenceKeys.filter((k) => !k.startsWith('vhs'))).toEqual([])
    const core = new Set(Object.keys(strings.zh))
    expect(referenceKeys.filter((k) => core.has(k))).toEqual([])
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

  it('every locale other than English has its own words (no English left in a translated shard)', () => {
    const en = table('en')
    const same = (lang: (typeof LANGS)[number]) =>
      referenceKeys.filter(
        (k) =>
          table(lang)[k] === en[k] &&
          // a name shared by the languages, a bare placeholder, or a word that is the same abroad
          !['vhsAuthorAgent', 'vhsReasonAgent', 'vhsRowVersion'].includes(k),
      )
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      // a handful of cognates (de "System", fr "Agent") may match; a whole shard of English may not
      expect(same(lang).length, lang).toBeLessThan(6)
    }
  })

  it('vi and en are the web strings verbatim (placeholders only re-braced)', () => {
    const vi = table('vi')
    const en = table('en')
    expect(vi.vhsTitle).toBe('Lịch sử phiên bản')
    expect(en.vhsTitle).toBe('Version history')
    expect(vi.vhsMenuEntry).toBe('Lịch sử phiên bản')
    expect(en.vhsDescription).toBe(
      'The version checkpoints kept on the server. Restoring writes a new version; history is never erased.',
    )
    expect(vi.vhsEmpty).toBe('Chưa có phiên bản nào. Tạo mốc đầu tiên từ bản đang làm việc.')
    expect(vi.vhsRowVersion).toBe('Phiên bản {no}')
    expect(en.vhsCurrentBadge).toBe('Current')
    expect(vi.vhsCurrentBadge).toBe('Bản hiện tại')
    expect(en.vhsNamePlaceholder).toBe('e.g. Before the review changes')
    expect(vi.vhsNameDone).toBe('Đã tạo phiên bản {no}')
    expect(en.vhsNameFailed).toBe('Could not create the checkpoint. What you typed is kept.')
    expect(vi.vhsRestore).toBe('Khôi phục phiên bản {no}')
    expect(en.vhsRestoreConfirmTitle).toBe('Restore version {no}?')
    expect(vi.vhsRestoreConfirmDescription).toBe(
      'Bản làm việc sẽ nhận nội dung của phiên bản này và một phiên bản khôi phục mới được ghi thêm. Lịch sử giữ nguyên.',
    )
    expect(en.vhsRestoreConflict).toBe(
      'The working copy just changed. Reopen the history and retry.',
    )
    expect(vi.vhsManageOnly).toBe('Bạn cần quyền sửa để khôi phục phiên bản.')
    expect(en.vhsShelvedBlocked).toBe('This document is archived and read-only.')
    expect(vi.vhsDownloadVersion).toBe('Tải phiên bản {no}')
    expect(en.vhsDownloadFailed).toBe('Could not download the file')
    expect(vi.vhsReasonManual).toBe('mốc thủ công')
    expect(en.vhsReasonUnknown).toBe('other')
    expect(vi.vhsAuthorFormer).toBe('Cựu thành viên')
    expect(en.vhsLockedByOther).toBe(
      'Someone else is editing this document. Wait until they finish or take over editing, then try again.',
    )
    expect(vi.vhsLockedByMe).toBe(
      'Bạn đang sửa tài liệu này ở một cửa sổ khác. Lưu hoặc đóng cửa sổ đó rồi thử lại.',
    )
  })

  it('no git word or internal code in the vi/en copy', () => {
    const text = [...Object.values(table('vi')), ...Object.values(table('en'))].join('\n')
    expect(text).not.toMatch(/\b(git|github|commit|branch)\b/i)
    expect(text).not.toMatch(/\b(GO|UNI)-\d+/)
  })

  it('is registered with the renderer locale table', () => {
    const src = readFileSync(new URL('../src/renderer/src/locale.tsx', import.meta.url), 'utf8')
    expect(src).toContain('uniworkVersionStrings')
  })
})
