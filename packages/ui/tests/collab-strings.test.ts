import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  collabPanelStrings,
  collabPanelText,
  type CollabPanelStringKey,
} from '../src/strings-collab-panel'
import {
  collabMentionStrings,
  collabMentionText,
  type CollabMentionStringKey,
} from '../src/strings-collab-mention'

/**
 * Collab panel + mention picker copy (G8-20, spine "String catalogue G8"): every collab* key whose
 * Host column contains F. zh defines the key set; vi and en are the spine text, the other locales
 * keep the en placeholders, the brand name and carry no internal codes.
 */

// every spine row with F in the Host column, panel side (S12, S13, S15 panel-level messages)
const PANEL_KEYS = [
  // Panel, trạng thái panel
  'collabComments',
  'collabDiscussion',
  'collabClosePanel',
  'collabLabelCount',
  'collabLoading',
  'collabEmptyComments',
  'collabEmptyDiscussion',
  'collabLoadError',
  'collabLoadErrorBody',
  'collabRetry',
  'collabOffline',
  'collabServerError',
  'collabSignedOut',
  'collabNoAccess',
  'collabNoAccessBody',
  'collabViewOnlyBadge',
  'collabViewOnly',
  'collabUpdatedAnnounce',
  // Neo
  'collabAnchorDocx',
  'collabAnchorCell',
  'collabAnchorSlide',
  'collabAnchorPage',
  'collabAnchorStale',
  'collabAnchorLost',
  'collabGoToAnchor',
  // Thread, thao tác, lịch sử
  'collabResolved',
  'collabResolve',
  'collabReopen',
  'collabReply',
  'collabReplyCount',
  'collabActions',
  'collabEdit',
  'collabSave',
  'collabCancel',
  'collabDelete',
  'collabCopyText',
  'collabDeleteTitle',
  'collabDeleteBody',
  'collabDeleteConfirm',
  'collabDeleted',
  'collabEdited',
  'collabFormerMember',
  'collabHistory',
  'collabHistoryTitle',
  'collabHistoryCurrent',
  'collabHistoryEntry',
  'collabHistoryEmpty',
  'collabHistoryError',
  'collabActionFailed',
  // Composer
  'collabComposerComment',
  'collabComposerReply',
  'collabComposerDiscussion',
  'collabSend',
  'collabSendHint',
  'collabSending',
  'collabSendFailed',
  'collabCommentDeleted',
  'collabDiscussionDeleted',
  'collabDiscardTitle',
  'collabDiscardBody',
  'collabDiscard',
  'collabKeepWriting',
  'collabAiDraftLabel',
  // Bình luận trong tệp
  'collabInFileSection',
  'collabInFileHint',
  // G8-18 mention access warning & post-send notice
  'collabMentionWarnTitle',
  'collabMentionWarnBody',
  'collabShareViewThenSend',
  'collabSendWithoutNotify',
  'collabMentionAskManager',
  'collabMentionMixedUnshareable',
  'collabSharingView',
  'collabShareViewFailed',
  'collabShareViewPartial',
  'collabSendComment',
  'collabRetryShareFor',
  'collabSendFailedAfterShare',
  'collabPostSendNoAccess',
  'collabPostSendShareAction',
  'collabPostSendNoRetroNote',
  'collabDismissNotice',
] as const

// Picker mention (S14)
const MENTION_KEYS = [
  'collabMentionLabel',
  'collabMentionSearching',
  'collabMentionCount',
  'collabMentionNoMatch',
  'collabMentionNoCandidates',
  'collabMentionError',
  'collabMentionNoAccessBadge',
] as const

// rows with D only: the fork must not carry them
const D_ONLY_KEYS = ['collabEmptyCommentsNoEditor', 'inboxDocGone', 'inboxBack']

const COUNT_KEYS = ['collabLabelCount', 'collabReplyCount', 'collabMentionCount'] as const

const SUITES = [
  { name: 'panel', strings: collabPanelStrings, keys: PANEL_KEYS },
  { name: 'mention', strings: collabMentionStrings, keys: MENTION_KEYS },
] as const

const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const tableOf = (strings: object, lang: string) =>
  (strings as Record<string, Record<string, string>>)[lang]!

describe.each(SUITES)('collab $name strings', ({ strings, keys }) => {
  const en = tableOf(strings, 'en')

  it('covers every UI language', () => {
    expect(Object.keys(strings).sort()).toEqual([...LANGS].sort())
  })

  it('defines exactly the spine F keys, no D-only keys', () => {
    expect(Object.keys(tableOf(strings, 'zh')).sort()).toEqual([...keys].sort())
    for (const k of D_ONLY_KEYS) expect(tableOf(strings, 'zh')).not.toHaveProperty(k)
  })

  it.each([...LANGS])('locale %s has the zh key set and no empty values', (lang) => {
    expect(Object.keys(tableOf(strings, lang)).sort()).toEqual([...keys].sort())
    expect(Object.entries(tableOf(strings, lang)).filter(([, v]) => !v.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the en placeholders per key', (lang) => {
    const t = tableOf(strings, lang)
    expect(keys.filter((k) => placeholdersOf(t[k]!) !== placeholdersOf(en[k]!))).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the UniWork brand intact', (lang) => {
    const t = tableOf(strings, lang)
    for (const k of keys) {
      for (const brand of ['UniWork AI', 'UniWork']) {
        if (en[k]!.includes(brand)) expect(t[k], `${lang}.${k}`).toContain(brand)
      }
      // no case-mangled brand anywhere (Uniwork, UNIWORK, uniwork)
      const mangled = (t[k]!.match(/uniwork/gi) ?? []).filter((m) => m !== 'UniWork')
      expect(mangled, `${lang}.${k}`).toEqual([])
    }
  })

  it.each([...LANGS])('locale %s has no internal codes, repo or vendor names', (lang) => {
    const bad = Object.entries(tableOf(strings, lang)).filter(([, v]) =>
      /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d|\bG\d+-\d|\bS1\d\b/i.test(v),
    )
    expect(bad).toEqual([])
  })

  it('uses no plural-form keys and no ICU plural', () => {
    expect(keys.filter((k) => /(One|Few|Many|Other)$/.test(k))).toEqual([])
    for (const lang of LANGS) {
      expect(Object.values(tableOf(strings, lang)).filter((v) => v.includes(', plural,'))).toEqual(
        [],
      )
    }
  })
})

describe('collab strings: spine text', () => {
  it('says what the catalogue says in vi and en', () => {
    const p = collabPanelStrings
    expect(p.vi.collabComments).toBe('Bình luận')
    expect(p.en.collabComments).toBe('Comments')
    expect(p.vi.collabClosePanel).toBe('Đóng {panel}')
    expect(p.en.collabEmptyComments).toBe(
      'No comments yet. Select something in the document, then choose Comment.',
    )
    expect(p.vi.collabEmptyDiscussion).toBe(
      'Chưa có thảo luận. Hãy viết điều bạn muốn trao đổi về tài liệu này.',
    )
    expect(p.en.collabOffline).toBe(
      'Can’t reach UniWork. You can still read what’s already loaded, but you can’t send yet.',
    )
    expect(p.vi.collabAnchorDocx).toBe('Đoạn: “{quote}”')
    expect(p.en.collabAnchorSlide).toBe('Slide {slide}')
    expect(p.vi.collabResolved).toBe('Đã giải quyết')
    expect(p.vi.collabResolve).toBe('Giải quyết')
    expect(p.en.collabReopen).toBe('Reopen')
    expect(p.en.collabDeleteBody).toBe(
      'The text and edit history will be permanently deleted. Any replies stay.',
    )
    expect(p.vi.collabSendHint).toBe('{shortcut} để gửi')
    expect(p.vi.collabAiDraftLabel).toBe('Bản nháp do UniWork AI gợi ý. Xem lại rồi bấm Gửi.')
    expect(p.en.collabInFileHint).toBe(
      'Saved in the file and read-only: you can’t edit or reply here.',
    )
    const m = collabMentionStrings
    expect(m.vi.collabMentionNoMatch).toBe(
      'Không có ai khớp “{query}” trong số người xem được tài liệu này.',
    )
    expect(m.en.collabMentionNoCandidates).toBe('No one else has access to this document yet.')
    expect(m.vi.collabMentionNoAccessBadge).toBe('Chưa xem được')
    expect(m.en.collabMentionNoAccessBadge).toBe("Can't view")
    expect(p.vi.collabMentionWarnTitle).toBe('Người được nhắc chưa có quyền xem')
    expect(p.en.collabMentionWarnTitle).toBe("Mentioned people can't view this document")
    expect(p.vi.collabMentionWarnBody).toBe(
      '{names} chưa xem được tài liệu này nên sẽ không nhận thông báo.',
    )
    expect(p.en.collabMentionWarnBody).toBe(
      "{names} can't view this document, so they won't be notified.",
    )
    expect(p.vi.collabShareViewThenSend).toBe('Chia sẻ quyền Xem rồi gửi')
    expect(p.en.collabShareViewThenSend).toBe('Share view access, then send')
    expect(p.vi.collabSendWithoutNotify).toBe('Gửi, không thông báo')
    expect(p.en.collabSendWithoutNotify).toBe('Send without notifying')
    expect(p.vi.collabMentionAskManager).toBe(
      'Hãy nhờ người quản lý tài liệu chia sẻ quyền Xem cho {names}.',
    )
    expect(p.en.collabMentionAskManager).toBe(
      'Ask someone who manages this document to share view access with {names}.',
    )
    expect(p.vi.collabMentionMixedUnshareable).toBe(
      'Không thể chia sẻ cho {unshareable}; những người này sẽ không nhận thông báo.',
    )
    expect(p.en.collabMentionMixedUnshareable).toBe(
      "Can't share with {unshareable}; they won't be notified.",
    )
    expect(p.vi.collabSharingView).toBe('Đang chia sẻ quyền Xem…')
    expect(p.en.collabSharingView).toBe('Sharing view access…')
    expect(p.vi.collabShareViewFailed).toBe(
      'Chưa chia sẻ được quyền Xem cho {failedNames}. Bạn có thể thử lại hoặc gửi mà không thông báo.',
    )
    expect(p.en.collabShareViewFailed).toBe(
      "Couldn't share view access with {failedNames}. You can try again or send without notifying.",
    )
    expect(p.vi.collabShareViewPartial).toBe(
      'Đã chia sẻ quyền Xem cho {sharedNames}. Chưa chia sẻ được cho {failedNames} (sẽ không nhận thông báo).',
    )
    expect(p.en.collabShareViewPartial).toBe(
      "Shared view access with {sharedNames}. Couldn't share with {failedNames} (they won't be notified).",
    )
    expect(p.vi.collabSendComment).toBe('Gửi bình luận')
    expect(p.en.collabSendComment).toBe('Send comment')
    expect(p.vi.collabRetryShareFor).toBe('Thử lại cho {failedNames}')
    expect(p.en.collabRetryShareFor).toBe('Try again for {failedNames}')
    expect(p.vi.collabSendFailedAfterShare).toBe(
      'Đã chia sẻ quyền Xem cho {sharedNames} nhưng chưa gửi được bình luận. Nội dung vẫn còn trong ô soạn — hãy thử gửi lại.',
    )
    expect(p.en.collabSendFailedAfterShare).toBe(
      "Shared view access with {sharedNames}, but couldn't send the comment. Your text is still in the box — try sending again.",
    )
    expect(p.vi.collabPostSendNoAccess).toBe(
      '{names} chưa xem được tài liệu này nên đã không nhận thông báo.',
    )
    expect(p.en.collabPostSendNoAccess).toBe(
      "{names} can't view this document, so they weren't notified.",
    )
    expect(p.vi.collabPostSendShareAction).toBe('Chia sẻ quyền Xem')
    expect(p.en.collabPostSendShareAction).toBe('Share view access')
    expect(p.vi.collabPostSendNoRetroNote).toBe(
      'Chia sẻ lúc này không gửi lại thông báo cho bình luận trên; hãy nhắc lại họ ở bình luận mới nếu cần.',
    )
    expect(p.en.collabPostSendNoRetroNote).toBe(
      "Sharing now won't notify them about this comment; mention them in a new comment to notify.",
    )
    expect(p.en.collabDismissNotice).toBe('Dismiss')
  })

  it('uses the fork sign-in verb in en (spine: fork writes "Sign in", D writes "Log in")', () => {
    expect(collabPanelStrings.en.collabSignedOut).toBe(
      'Your session has ended. Sign in again to send.',
    )
    expect(collabPanelStrings.vi.collabSignedOut).toBe(
      'Phiên đăng nhập đã hết. Đăng nhập lại để gửi.',
    )
  })

  it('names a close button from the already translated panel title', () => {
    expect(
      collabPanelText('vi', 'collabClosePanel', { panel: collabPanelStrings.vi.collabDiscussion }),
    ).toBe('Đóng Thảo luận')
    expect(
      collabPanelText('en', 'collabClosePanel', { panel: collabPanelStrings.en.collabComments }),
    ).toBe('Close Comments')
  })
})

describe('collab strings: counts are neutral with the number', () => {
  const COUNT_LANGS = ['vi', 'en', 'ru', 'pl'] as const
  const render = (
    lang: (typeof COUNT_LANGS)[number],
    key: (typeof COUNT_KEYS)[number],
    n: number,
  ) =>
    key === 'collabMentionCount'
      ? collabMentionText(lang, key, { count: n })
      : key === 'collabReplyCount'
        ? collabPanelText(lang, key, { count: n })
        : collabPanelText(lang, key, { label: 'X', count: n })

  it.each(COUNT_LANGS.flatMap((l) => COUNT_KEYS.map((k) => [l, k] as const)))(
    '%s %s renders at 1, 2, 5',
    (lang, key) => {
      for (const n of [1, 2, 5]) {
        const out = render(lang, key, n)
        expect(out).toMatch(new RegExp(`(^|\\D)${n}(\\D|$)`))
        expect(out).not.toMatch(/[{}]/)
      }
    },
  )

  it('has exactly three keys with {count}, one meaning each', () => {
    const withCount: string[] = []
    for (const s of [collabPanelStrings.en, collabMentionStrings.en] as Record<string, string>[]) {
      for (const [k, v] of Object.entries(s)) if (v.includes('{count}')) withCount.push(k)
    }
    expect(withCount.sort()).toEqual([...COUNT_KEYS].sort())
  })

  it('renders the spine sentences in vi and en', () => {
    expect(collabPanelText('vi', 'collabReplyCount', { count: 2 })).toBe('Trả lời: 2')
    expect(collabPanelText('en', 'collabReplyCount', { count: 1 })).toBe('Replies: 1')
    expect(collabPanelText('en', 'collabLabelCount', { label: 'Comments', count: 5 })).toBe(
      'Comments · 5',
    )
    expect(collabMentionText('vi', 'collabMentionCount', { count: 5 })).toBe('Kết quả: 5')
  })
})

// compile-time: the key unions are the zh key sets
const _panelKey: CollabPanelStringKey = 'collabSend'
const _mentionKey: CollabMentionStringKey = 'collabMentionLabel'
void _panelKey
void _mentionKey
