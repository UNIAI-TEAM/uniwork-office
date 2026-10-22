import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { inboxStrings } from '../src/renderer/src/i18n/strings-inbox'
import { strings } from '../src/renderer/src/strings'
import { workbenchStrings } from '../src/renderer/src/i18n/strings-workbench'

/**
 * Inbox shard (i18n/inbox/<lang>.ts): zh defines the key set; vi and en follow the web's
 * `notifications.*` wording; the other locales hold the English text until the locale sweep.
 */

const referenceKeys = Object.keys(inboxStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => inboxStrings[lang] as Record<string, string>

describe('inbox string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(inboxStrings).sort()).toEqual([...LANGS].sort())
  })

  it.each([...LANGS])('locale %s has exactly the zh key set, no empty values', (lang) => {
    expect(Object.keys(table(lang)).sort()).toEqual(referenceKeys)
    expect(Object.entries(table(lang)).filter(([, v]) => !v.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the zh placeholders', (lang) => {
    expect(
      referenceKeys.filter(
        (k) => placeholdersOf(table(lang)[k]!) !== placeholdersOf(table('zh')[k]!),
      ),
    ).toEqual([])
  })

  it('uses the inbox prefix and collides with no other dictionary', () => {
    expect(referenceKeys.filter((k) => !k.startsWith('inbox'))).toEqual([])
    expect(referenceKeys.filter((k) => k in strings.zh || k in workbenchStrings.zh)).toEqual([])
  })

  it.each([...LANGS])('locale %s has no repository words or internal codes', (lang) => {
    const bad = Object.values(table(lang)).filter((v) =>
      /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d|\bG\d-\d/i.test(v),
    )
    expect(bad).toEqual([])
  })

  it('words the chrome like the web in Vietnamese and English', () => {
    expect(inboxStrings.vi.inboxTitle).toBe('Hộp việc')
    expect(inboxStrings.en.inboxTitle).toBe('Inbox')
    expect(inboxStrings.vi.inboxMarkAllRead).toBe('Đánh dấu tất cả đã đọc')
    expect(inboxStrings.en.inboxMarkAllRead).toBe('Mark all as read')
    expect(inboxStrings.vi.inboxCategoryMentions).toBe('Nhắc & bình luận')
    expect(inboxStrings.en.inboxCategoryUpdates).toBe('Task updates')
    expect(inboxStrings.vi.inboxGroupWeek).toBe('7 ngày qua')
    expect(inboxStrings.en.inboxUndo).toBe('Undo')
    expect(inboxStrings.vi.inboxLoadOlder).toBe('Xem thông báo cũ hơn')
  })

  it('has a one and an other form for every counted string', () => {
    for (const k of referenceKeys.filter((k) => k.endsWith('One')))
      expect(referenceKeys).toContain(k.replace(/One$/, 'Other'))
  })

  it('has the keys the Inbox pane needs', () => {
    expect(
      [
        'inboxTitle',
        'inboxFilterAll',
        'inboxFilterUnread',
        'inboxCategoryAny',
        'inboxCategoryMentions',
        'inboxCategoryAssigned',
        'inboxCategoryMeetings',
        'inboxCategoryUpdates',
        'inboxCategoryWorkspace',
        'inboxCategoryUnreadOne',
        'inboxCategoryUnreadOther',
        'inboxMarkAllRead',
        'inboxGroupUnread',
        'inboxGroupToday',
        'inboxGroupYesterday',
        'inboxGroupWeek',
        'inboxGroupOlder',
        'inboxMarkRead',
        'inboxMarkUnread',
        'inboxArchive',
        'inboxArchivedOne',
        'inboxArchivedOther',
        'inboxMarkedAllOne',
        'inboxMarkedAllOther',
        'inboxUndo',
        'inboxUndoFailed',
        'inboxEmptyTitle',
        'inboxEmptyUnreadTitle',
        'inboxEmptyDescription',
        'inboxEmptyCategoryTitle',
        'inboxEmptyCategoryDescription',
        'inboxEmptyCategoryMore',
        'inboxShowAnyCategory',
        'inboxLoadOlder',
        'inboxLoadingOlder',
        'inboxEndOfList',
        'inboxErrorTitle',
        'inboxError',
        'inboxLoading',
        'inboxOpensInBrowser',
      ].filter((k) => !referenceKeys.includes(k)),
    ).toEqual([])
  })
})
