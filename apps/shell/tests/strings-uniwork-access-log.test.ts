import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkAccessLogStrings } from '../src/renderer/src/i18n/strings-uniwork-access-log'
import { strings } from '../src/renderer/src/strings'

/**
 * The access-log shard (i18n/uniwork-access-log/<lang>.ts, UNI-2077): zh defines the key set;
 * 21 locales with the zh placeholders; vi + en are the web's own copy (documents.accessLog.*).
 */

const referenceKeys = Object.keys(uniworkAccessLogStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) =>
  uniworkAccessLogStrings[lang] as Record<string, string>

describe('uniwork access log string shard', () => {
  it('covers every UI language (21)', () => {
    expect(Object.keys(uniworkAccessLogStrings).sort()).toEqual([...LANGS].sort())
    expect(LANGS).toHaveLength(21)
  })

  it('keys are prefixed alg and never collide with another shard', () => {
    expect(referenceKeys.filter((k) => !k.startsWith('alg'))).toEqual([])
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

  it('vi and en are the web strings verbatim (placeholders only re-braced)', () => {
    const vi = table('vi')
    const en = table('en')
    expect(vi.algMenu).toBe('Nhật ký truy cập')
    expect(en.algMenu).toBe('Access log')
    expect(vi.algDescription).toBe(
      'Ai đã xem, tải hoặc mở tài liệu qua liên kết. Chỉ người quản lý thấy được.',
    )
    expect(en.algDescription).toBe(
      'Who viewed, downloaded or opened the document through a link. Only managers can read it.',
    )
    expect(vi.algManageOnly).toBe('Bạn cần quyền quản lý để xem nhật ký truy cập.')
    expect(en.algManageOnly).toBe('You need manage access to read the access log.')
    expect(vi.algActionLinkView).toBe('Mở qua liên kết')
    expect(en.algActionLinkView).toBe('Opened via link')
    expect(vi.algActorAnonymous).toBe('Ẩn danh')
    expect(vi.algVersion).toBe('phiên bản {no}')
    expect(en.algVersion).toBe('version {no}')
    expect(en.algEmpty).toBe('No access recorded yet.')
    expect(vi.algFilterAll).toBe('Tất cả hành động')
  })
})
