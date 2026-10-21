import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { askUniStrings } from '../src/renderer/src/i18n/strings-askuni'
import { discussionStrings } from '../src/renderer/src/i18n/strings-discussion'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { uniworkHomeStrings } from '../src/renderer/src/i18n/strings-uniwork-home'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { cloudStrings } from '../src/renderer/src/i18n/strings-cloud'
import { settingsStrings } from '../src/renderer/src/i18n/strings-settings'
import { strings } from '../src/renderer/src/strings'

/**
 * Ask UNI shard of the shell Home (i18n/askuni/<lang>.ts): mode toggle, composer, sources list and
 * the per-state copy of the My AI "Ask UNI" mode. zh defines the key set; vi/en reuse the web Ask UNI
 * wording (packages/core/i18n ai.*) wherever the web has a key.
 */

const referenceKeys = Object.keys(askUniStrings.zh).sort()
const table = (lang: (typeof LANGS)[number]) => askUniStrings[lang] as Record<string, string>

describe('askuni string shard', () => {
  it('covers every UI language', () => {
    expect(Object.keys(askUniStrings).sort()).toEqual([...LANGS].sort())
  })

  it.each([...LANGS])('locale %s has exactly the zh key set, no empty values', (lang) => {
    expect(Object.keys(table(lang)).sort()).toEqual(referenceKeys)
    expect(Object.entries(table(lang)).filter(([, v]) => !v.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the same {params} as zh', (lang) => {
    const params = (v: string) => (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort()
    const bad = referenceKeys.filter(
      (k) =>
        params(table(lang)[k] ?? '').join() !== params(askUniStrings.zh[k as 'askUniTitle']).join(),
    )
    expect(bad).toEqual([])
  })

  it.each([...LANGS])('locale %s has no repository words or internal codes', (lang) => {
    const bad = Object.values(table(lang)).filter((v) =>
      /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d|\bG8-\d|\bS1[35]\b|ai_[a-z_]+|byok/i.test(
        v,
      ),
    )
    expect(bad).toEqual([])
  })

  it('does not collide with the other shell shards', () => {
    expect(
      referenceKeys.filter(
        (k) =>
          k in strings.zh ||
          k in accountStrings.zh ||
          k in cloudStrings.zh ||
          k in uniworkDocumentStrings.zh ||
          k in uniworkHomeStrings.zh ||
          k in settingsStrings.zh ||
          k in discussionStrings.zh ||
          k in syncStrings.zh,
      ),
    ).toEqual([])
  })

  it('writes the other locales properly, not as English copies', () => {
    // short proper nouns / loan words may legitimately match English
    const allowed = new Set([
      'askUniUni',
      'askUniTitle',
      'askUniModeAsk',
      'askUniModeGroup',
      'askUniModeChat',
      'askUniSources',
      'askUniKindDocument',
      'askUniCitationLabel',
    ])
    for (const lang of LANGS) {
      if (lang === 'en') continue
      const same = referenceKeys.filter(
        (k) =>
          !allowed.has(k) && table(lang)[k] === (askUniStrings.en as Record<string, string>)[k],
      )
      expect(same, `${lang} copies English for: ${same.join(', ')}`).toEqual([])
    }
  })

  it('uses the web Ask UNI wording in vi and en', () => {
    const vi = askUniStrings.vi
    const en = askUniStrings.en
    expect(vi.askUniTitle).toBe('Hỏi UNI')
    expect(en.askUniTitle).toBe('Ask UNI')
    expect(vi.askUniSources).toBe('Nguồn')
    expect(en.askUniSources).toBe('Sources')
    expect(vi.askUniNoticeNoSources).toBe('Chưa có dữ liệu nào bạn được xem khớp với câu hỏi này.')
    expect(en.askUniNoticeNoSources).toBe(
      'Nothing you can see in this workspace matches this question yet.',
    )
    expect(vi.askUniNoticeUnavailable).toBe('UNI chưa trả lời được câu này.')
    expect(en.askUniNoticeUnavailable).toBe("UNI couldn't answer this one.")
    expect(vi.askUniErrForbidden).toBe('Bạn không có quyền xem dữ liệu này.')
    expect(en.askUniErrForbidden).toBe('You do not have access to this data.')
    expect(vi.askUniErrQuota).toBe('Tổ chức đã hết hạn mức token AI của tháng.')
    expect(en.askUniErrQuota).toBe('The organization has used its AI token quota for this month.')
    expect(vi.askUniErrRateLimited).toBe('Bạn hỏi quá nhanh, thử lại sau một phút.')
    expect(en.askUniErrRateLimited).toBe('You are asking too fast; try again in a minute.')
    expect(vi.askUniErrDisabled).toBe('AI chưa được cấu hình trên server.')
    expect(en.askUniErrDisabled).toBe('AI is not configured on this server.')
    expect(vi.askUniErrOffline).toBe('Không có kết nối mạng, Hỏi UNI cần kết nối để tìm tài liệu.')
    expect(en.askUniErrOffline).toBe(
      'You are offline. Ask UNI needs a connection to search documents.',
    )
    expect(vi.askUniErrDefault).toBe('Không hỏi được lúc này, thử lại sau.')
    expect(en.askUniErrDefault).toBe('Could not ask right now; try again later.')
    expect(vi.askUniPlaceholder).toBe('Hỏi UNI về công việc…')
    expect(en.askUniPlaceholder).toBe('Ask UNI about your work…')
    expect(vi.askUniNewChat).toBe('Hội thoại mới')
    expect(en.askUniNewChat).toBe('New chat')
  })

  it('carries the keys the web has no wording for (offline, session, open document/browser)', () => {
    for (const key of [
      'askUniErrOffline',
      'askUniKindOther',
      'askUniErrSession',
      'askUniErrRateLimitedIn',
      'askUniOpenDocument',
      'askUniOpenBrowser',
      'askUniSignedOut',
    ]) {
      expect(referenceKeys).toContain(key)
    }
    expect(askUniStrings.en.askUniErrRateLimitedIn).toContain('{seconds}')
    expect(askUniStrings.vi.askUniErrRateLimitedIn).toContain('{seconds}')
  })
})
