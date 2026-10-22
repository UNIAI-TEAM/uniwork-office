import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkHomeStrings } from '../src/renderer/src/i18n/strings-uniwork-home'

/**
 * The fu* keys of the uniwork-home shard (UNI-2052 folder / multi-file upload):
 * zh defines the key set, vi + en are the glossary copy of the web's
 * documents.folder_upload.*, the other locales are translated (a few
 * words are legitimately the same as English); no internal codes or git words in any sentence.
 */

const table = (lang: (typeof LANGS)[number]) => uniworkHomeStrings[lang] as Record<string, string>
const fuKeys = Object.keys(table('zh'))
  .filter((k) => k.startsWith('fu'))
  .sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const OTHER_LOCALES = LANGS.filter((l) => !['zh', 'vi', 'en'].includes(l))

describe('folder-upload strings (uniwork-home shard)', () => {
  it('has the keys the screens read', () => {
    expect(fuKeys.length).toBeGreaterThan(60)
    for (const key of [
      'fuMenuFiles',
      'fuMenuFolder',
      'fuDlgTitleFolder',
      'fuDlgShare',
      'fuBarCancelAll',
      'fuBarDone',
      'fuBarPartial',
      'fuRepRetry',
      'fuDropTitle',
      'fuBarBusy',
      'fuBarBusyFiles',
      'fuBarExpired',
      'fuBarExpiredFiles',
      'fuDestForbidden',
      'fuDestNotFound',
      'fuDlgShareInherited',
    ]) {
      expect(fuKeys).toContain(key)
    }
  })

  it.each([...LANGS])('locale %s has every fu key, none empty', (lang) => {
    const t = table(lang)
    expect(fuKeys.filter((k) => !(k in t))).toEqual([])
    expect(fuKeys.filter((k) => !t[k]?.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the zh placeholders', (lang) => {
    const zh = table('zh')
    const t = table(lang)
    expect(fuKeys.filter((k) => placeholdersOf(t[k]!) !== placeholdersOf(zh[k]!))).toEqual([])
  })

  it('the One keys exist next to their plain key', () => {
    for (const key of fuKeys.filter((k) => k.endsWith('One'))) {
      expect(fuKeys).toContain(key.slice(0, -3))
    }
  })

  it('vi and en are real copy, the other locales are translated', () => {
    const vi = table('vi')
    const en = table('en')
    expect(vi.fuMenuFolder).toBe('Tải lên thư mục')
    expect(vi.fuBarRunning).toBe('Đang tải lên “{name}” — {done}/{total} tệp')
    expect(en.fuBarRunning).toBe('Uploading “{name}” — {done}/{total} files')
    expect(vi.fuDlgShare).toBe('Chia sẻ với workspace')
    // the whole-run sentences are the web's error.* / toast.expired* copy
    expect(en.fuBarBusy).toBe('Too many folder uploads are running. Try again in a few minutes.')
    expect(en.fuBarExpired).toBe(
      'The upload of “{name}” expired — {done}/{total} files went up. Upload the folder again.',
    )
    expect(vi.fuDestNotFound).toBe(
      'Không tìm thấy thư mục đích. Có thể nó đã bị xóa hoặc chuyển đi.',
    )
    expect(en.fuDlgShareInherited).toBe(
      'The destination folder is shared with the workspace, so the files are too.',
    )
    // Words that are the same as English in a few languages.
    const sameAsEn: Record<string, string[] | undefined> = {
      fuDlgRoot: ['id', 'ms', 'pl'],
      fuDlgSummaryOne: ['id', 'it'],
      // UNI-2075: English until the translation pass lands; drop this line with it
      fuDlgShareHintWorkspace: [...OTHER_LOCALES],
    }
    for (const lang of OTHER_LOCALES) {
      const same = fuKeys.filter((k) => table(lang)[k] === en[k])
      const allowed = ['fuDlgSkippedReason', ...fuKeys.filter((k) => sameAsEn[k]?.includes(lang))]
      expect(same.filter((k) => !allowed.includes(k))).toEqual([])
    }
  })

  it('no sentence carries an internal code or a git word', () => {
    const banned = /\b(GO-\d+|UNI-\d+|git|github|commit|branch)\b/i
    for (const lang of LANGS) {
      const t = table(lang)
      expect(fuKeys.filter((k) => banned.test(t[k]!))).toEqual([])
    }
  })
})
