import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

/**
 * UNI-1993 source view copy (shard i18n/uniwork-documents): every key in every
 * locale, vi and en exactly as the contract words them, the placeholders kept,
 * and a real translation (not the English text) in the other locales.
 */

const KEYS = [
  'uwChipSourceView',
  'uwTipSourceView',
  'uwSourceViewSaveHint',
  'uwSourceOriginChat',
  'uwSourceOriginTask',
  'uwSourceOriginMeeting',
  'uwSourceOriginEmail',
] as const

const table = (lang: string) =>
  uniworkDocumentStrings[lang as (typeof LANGS)[number]] as Record<string, string>
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')

const EN: Record<(typeof KEYS)[number], string> = {
  uwChipSourceView: 'View only · From {origin}',
  uwTipSourceView:
    "This file is attached in {origin}{parent}. Changes won't be saved. To get a copy, use Download in the Documents list.",
  uwSourceViewSaveHint: "This file is view only — changes aren't saved.",
  uwSourceOriginChat: 'Chat',
  uwSourceOriginTask: 'Tasks',
  uwSourceOriginMeeting: 'Meetings',
  uwSourceOriginEmail: 'Email',
}

const VI: Record<(typeof KEYS)[number], string> = {
  uwChipSourceView: 'Chỉ xem · Từ {origin}',
  uwTipSourceView:
    'Đây là tệp đính kèm trong {origin}{parent}. Thay đổi sẽ không được lưu. Muốn có bản sao, dùng Tải xuống ở danh sách Tài liệu.',
  uwSourceViewSaveHint: 'Tệp này chỉ để xem — thay đổi không được lưu.',
  uwSourceOriginChat: 'Chat',
  uwSourceOriginTask: 'Công việc',
  uwSourceOriginMeeting: 'Cuộc họp',
  uwSourceOriginEmail: 'Email',
}

describe('source view copy', () => {
  it('en and vi are exactly the contract wording', () => {
    for (const key of KEYS) {
      expect(table('en')[key], `en ${key}`).toBe(EN[key])
      expect(table('vi')[key], `vi ${key}`).toBe(VI[key])
    }
  })

  it.each([...LANGS])('locale %s has every key, non-empty, with the same placeholders', (lang) => {
    for (const key of KEYS) {
      const value = table(lang)[key]
      expect(value?.trim(), `${lang} ${key}`).toBeTruthy()
      expect(placeholdersOf(value!), `${lang} ${key} placeholders`).toBe(placeholdersOf(EN[key]))
    }
  })

  it.each([...LANGS].filter((lang) => lang !== 'en'))(
    'locale %s translates the chip, the tooltip and the save hint',
    (lang) => {
      for (const key of ['uwChipSourceView', 'uwTipSourceView', 'uwSourceViewSaveHint'] as const) {
        expect(table(lang)[key], `${lang} ${key}`).not.toBe(EN[key])
      }
    },
  )

  it.each([...LANGS])('locale %s names no git, repository or internal code', (lang) => {
    const bad = KEYS.map((key) => table(lang)[key]!).filter((v) =>
      /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d/i.test(v),
    )
    expect(bad).toEqual([])
  })
})
