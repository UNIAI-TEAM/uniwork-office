import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  aiUniworkStrings,
  aiUniworkText,
  isUniworkQuestionRefusal,
} from '../src/strings-ai-uniwork'

/**
 * Shared UniWork AI shard (ai-uniwork/<lang>.ts, U-02 closed catalogue): zh defines the key set;
 * every UI language has a real translation with the zh placeholders and keeps the provider name.
 */

const referenceKeys = Object.keys(aiUniworkStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => aiUniworkStrings[lang] as Record<string, string>

describe('ai-uniwork string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(aiUniworkStrings).sort()).toEqual([...LANGS].sort())
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

  it.each([...LANGS])('locale %s has no upstream brand or internal codes', (lang) => {
    const bad = Object.values(table(lang)).filter((v) =>
      /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d/i.test(v),
    )
    expect(bad).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the provider name untranslated', (lang) => {
    expect(table(lang).aiUniworkProvider).toBe('UniWork AI')
    expect(table(lang).aiUniworkFooterSignIn).toContain('UniWork AI')
  })

  it('uses one key per counted string: no plural-form keys and no ICU plural', () => {
    // aiRunChooseOther is a catalogue name, not a plural form: only a One/Few/Many key or an Other
    // key with a One sibling counts as a plural family
    const pluralForm = (k: string) =>
      /(One|Few|Many)$/.test(k) ||
      (k.endsWith('Other') && referenceKeys.includes(`${k.slice(0, -5)}One`))
    expect(referenceKeys.filter(pluralForm)).toEqual([])
    for (const lang of LANGS) {
      expect(Object.values(table(lang)).filter((v) => v.includes(', plural,'))).toEqual([])
    }
  })

  it('says what the catalogue says in vi and en', () => {
    expect(aiUniworkStrings.en.aiUniworkSendNeedsAck).toBe(
      'Read and confirm the notice before sending.',
    )
    expect(aiUniworkStrings.vi.aiUniworkSendNeedsAck).toBe(
      'Hãy đọc và xác nhận lời công bố trước khi gửi.',
    )
    expect(aiUniworkStrings.en.aiErrOffline).toBe(
      'You’re offline. UniWork AI doesn’t run offline and requests aren’t queued.',
    )
    expect(aiUniworkStrings.vi.aiRunOpenInApp).toBe('Mở bằng ứng dụng')
  })

  it('pins the run-notice copy of the adapter, loop and panels in vi and en (G6-05 S2)', () => {
    const pins: Array<
      [
        Parameters<typeof aiUniworkText>[1],
        Record<string, string | number> | undefined,
        string,
        string,
      ]
    > = [
      [
        'aiErrRateLimited',
        { seconds: 120 },
        'You’re sending too fast. Try again in 120 s.',
        'Bạn đang gửi quá nhanh. Thử lại sau 120 giây.',
      ],
      [
        'aiErrRateLimitedNoWait',
        undefined,
        'You’re sending too fast. Try again in a few minutes.',
        'Bạn đang gửi quá nhanh. Hãy thử lại sau ít phút.',
      ],
      [
        'aiConversationRestarted',
        undefined,
        'The previous conversation expired, so UniWork AI started a new one and no longer remembers earlier turns. Send your question again to continue.',
        'Cuộc trò chuyện trước đã hết hạn nên UniWork AI bắt đầu cuộc mới và không còn nhớ các lượt trước. Gửi lại câu hỏi để tiếp tục.',
      ],
      [
        'aiConversationBoundary',
        { provider: 'UniWork AI' },
        'New conversation with UniWork AI: the turns above aren’t sent along.',
        'Cuộc trò chuyện mới với UniWork AI: các lượt phía trên không được gửi kèm.',
      ],
      [
        'aiErrViewOnlyEdit',
        undefined,
        'You only have view access to this document, so AI can’t edit it.',
        'Bạn chỉ có quyền xem tài liệu này nên AI không sửa được.',
      ],
      [
        'aiErrUnsupported',
        { module: 'Docs' },
        'UniWork AI can’t do this in Docs yet.',
        'UniWork AI chưa làm được thao tác này trong Docs.',
      ],
      [
        'aiUniworkOff',
        undefined,
        'UniWork AI is off for this document. Choose another provider.',
        'UniWork AI đang tắt cho tài liệu này. Chọn nhà cung cấp khác.',
      ],
      [
        'aiErrRunLimit',
        undefined,
        'This run reached UniWork AI’s step limit. Results so far are kept; split the request and ask again.',
        'Lượt này đã chạm giới hạn số bước của UniWork AI. Kết quả tới đây vẫn được giữ; hãy chia nhỏ yêu cầu rồi hỏi tiếp.',
      ],
    ]
    for (const [key, params, en, vi] of pins) {
      expect(aiUniworkText('en', key, params), `en ${key}`).toBe(en)
      expect(aiUniworkText('vi', key, params), `vi ${key}`).toBe(vi)
    }
  })

  it.each([...LANGS])(
    'RF3-2: locale %s keeps the r2 catalogue spoken credits wording (not the visible line)',
    (lang) => {
      const aria = table(lang).aiUniworkCreditsAria
      expect(aria).not.toBe(table(lang).cloudCreditsLeft)
      expect(placeholdersOf(aria)).toBe(placeholdersOf(table(lang).cloudCreditsLeft))
    },
  )

  it('RF3-2: pins the catalogue vi/en spoken credits strings', () => {
    const params = { remaining: 12, limit: 50 }
    expect(aiUniworkText('en', 'aiUniworkCreditsAria', params)).toBe('12 of 50 credits left')
    expect(aiUniworkText('vi', 'aiUniworkCreditsAria', params)).toBe('Còn 12 trên 50 tín dụng')
  })

  it.each([...LANGS])(
    'RF2-3: locale %s has a generic S9 error line that is not the unavailable text',
    (lang) => {
      const generic = table(lang).aiErrGeneric
      expect(generic?.trim().length).toBeGreaterThan(0)
      expect(generic).not.toBe(table(lang).aiErrUnavailable)
      expect(placeholdersOf(generic!)).toBe('')
    },
  )

  it('fills the placeholders through aiUniworkText', () => {
    expect(aiUniworkText('en', 'aiUniworkCreditsAria', { remaining: 12, limit: 50 })).toBe(
      '12 of 50 credits left',
    )
    expect(aiUniworkText('vi', 'aiErrRateLimited', { seconds: 30 })).toBe(
      'Bạn đang gửi quá nhanh. Thử lại sau 30 giây.',
    )
    expect(aiUniworkText('en', 'cloudCreditsLeft', { remaining: 10, limit: 100 })).toBe(
      '10 / 100 left',
    )
    expect(aiUniworkText('en', 'cloudCreditsRenews', { date: '2026-11-01' })).toBe(
      'Renews 2026-11-01',
    )
    expect(
      aiUniworkText('en', 'aiResultCellsMeta', {
        written: 4,
        range: 'A1:B2',
        overwritten: 2,
      }),
    ).toBe('Cells written: 4 (A1:B2) · Existing cells overwritten: 2')
  })

  it('aiResultCellsMetaNoOverwrite: the written-cells line without the overwritten count, in every locale', () => {
    expect(
      aiUniworkText('en', 'aiResultCellsMetaNoOverwrite', { written: 4, range: 'A1:B2' }),
    ).toBe('Cells written: 4 (A1:B2)')
    expect(
      aiUniworkText('vi', 'aiResultCellsMetaNoOverwrite', { written: 4, range: 'A1:B2' }),
    ).toBe('Đã ghi 4 ô (A1:B2)')
    for (const lang of LANGS) {
      const params = { written: 4, range: 'A1:B2' }
      const line = aiUniworkText(lang, 'aiResultCellsMetaNoOverwrite', params)
      expect(line, lang).not.toMatch(/[{}]/)
      expect(line, lang).toContain('4')
      expect(line, lang).toContain('A1:B2')
      // the leading part of the full line, minus the overwritten half: same wording, no invented count
      const full = aiUniworkText(lang, 'aiResultCellsMeta', { ...params, overwritten: 2 })
      expect(full.startsWith(line), lang).toBe(true)
    }
  })

  it('includes the G6-05u cloud, account, local-file restart, sheet meta, web 413 and composer notice keys in all locales (C6, RF1-18)', () => {
    expect(aiUniworkText('en', 'acctSignIn')).toBe('Sign in')
    expect(aiUniworkText('vi', 'acctSignIn')).toBe('Đăng nhập')
    expect(aiUniworkText('en', 'acctSignInAgain')).toBe('Sign in again')
    expect(aiUniworkText('vi', 'acctSignInAgain')).toBe('Đăng nhập lại')
    expect(aiUniworkText('en', 'cloudStateReady')).toBe('Available')
    expect(aiUniworkText('vi', 'cloudStateReady')).toBe('Sẵn sàng')
    expect(aiUniworkText('en', 'cloudInactiveBody')).toContain('subscription is not active')
    expect(aiUniworkText('vi', 'cloudInactiveBody')).toContain('không hoạt động')
    expect(aiUniworkText('en', 'aiUniworkLocalFileRestart')).toContain(
      'Local files start a new conversation',
    )
    expect(aiUniworkText('vi', 'aiUniworkLocalFileRestart')).toContain(
      'Tệp trên máy bắt đầu cuộc trò chuyện mới',
    )
    expect(aiUniworkText('en', 'aiErrWorkbookTooLarge')).toContain('workbook is too large')
    expect(aiUniworkText('vi', 'aiErrWorkbookTooLarge')).toContain('Bảng tính này quá lớn')

    // RF1-18: not_entitled and credits_exhausted composer note keys in all 19 locales
    expect(aiUniworkText('en', 'not_entitled' as never)).toContain(
      'plan does not include UniWork AI',
    )
    expect(aiUniworkText('vi', 'not_entitled' as never)).toContain(
      'Gói của tổ chức bạn chưa bao gồm UniWork AI',
    )
    expect(aiUniworkText('en', 'credits_exhausted' as never)).toContain(
      'used all its AI credits for this period',
    )
    expect(aiUniworkText('vi', 'credits_exhausted' as never)).toContain(
      'đã dùng hết tín dụng AI trong kỳ này',
    )
    for (const lang of LANGS) {
      const t = table(lang)
      expect(t.not_entitled?.trim().length, `${lang} not_entitled`).toBeGreaterThan(0)
      expect(t.credits_exhausted?.trim().length, `${lang} credits_exhausted`).toBeGreaterThan(0)
      if (lang !== 'en') {
        expect(t.not_entitled, `${lang} not_entitled localized`).not.toBe(table('en').not_entitled)
        expect(t.credits_exhausted, `${lang} credits_exhausted localized`).not.toBe(
          table('en').credits_exhausted,
        )
      }
    }
  })
})

describe('isUniworkQuestionRefusal', () => {
  it.each([...LANGS])('knows the two refusal messages of %s', (lang) => {
    expect(isUniworkQuestionRefusal(aiUniworkText(lang, 'aiErrQuestionTooLong'))).toBe(true)
    expect(isUniworkQuestionRefusal(aiUniworkText(lang, 'aiErrQuestionRejected'))).toBe(true)
  })

  it('is false for every other message and for nothing', () => {
    expect(isUniworkQuestionRefusal(aiUniworkText('vi', 'aiErrUnavailable'))).toBe(false)
    expect(isUniworkQuestionRefusal('Network error')).toBe(false)
    expect(isUniworkQuestionRefusal('')).toBe(false)
    expect(isUniworkQuestionRefusal(undefined)).toBe(false)
  })
})
