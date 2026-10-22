import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'
import { strings } from '../src/renderer/src/strings'

/**
 * The uniwork-share shard (i18n/uniwork-share/<lang>.ts): zh defines the key
 * set; 21 locales with the zh placeholders; vi + en are the web's own copy
 * (documents.share.*, documents.access_request.*, documents.breakGlass.*), the
 * other locales carry English until the translation pass.
 */

const referenceKeys = Object.keys(uniworkShareStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => uniworkShareStrings[lang] as Record<string, string>

describe('uniwork share string shard', () => {
  it('covers every UI language (21)', () => {
    expect(Object.keys(uniworkShareStrings).sort()).toEqual([...LANGS].sort())
    expect(LANGS).toHaveLength(21)
  })

  it('keys are prefixed shr and never collide with another shard', () => {
    expect(referenceKeys.filter((k) => !k.startsWith('shr'))).toEqual([])
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
    expect(vi.shrTitleNamed).toBe('Chia sẻ “{title}”')
    expect(en.shrTitleNamed).toBe('Share “{title}”')
    expect(en.shrStoredIn).toBe('Stored in: Workspace {workspace}')
    expect(vi.shrReqSectionTitle).toBe('Yêu cầu truy cập ({count})')
    expect(en.shrBgAccessPanelRow).toBe('{name} · expires {time} · Reason: {reason}')
    expect(en.shrLinkViewsOne).toBe('{count} view')
    expect(en.shrLinkViewsOther).toBe('{count} views')
  })

  it('SD-C: the bulk dialog and the Access cell names are the web strings verbatim', () => {
    const vi = table('vi')
    const en = table('en')
    expect(vi.shrBulkTitleOne).toBe('Chia sẻ {count} tài liệu')
    expect(en.shrBulkTitleOne).toBe('Share {count} document')
    expect(en.shrBulkTitleOther).toBe('Share {count} documents')
    expect(vi.shrBulkAppliesToOther).toBe('Áp dụng giống nhau cho {count} tài liệu bạn quản lý.')
    expect(en.shrBulkUpdateExisting).toBe('Change the level of people who already have access')
    expect(vi.shrBulkWorkspaceLabel).toBe('Workspace chứa tài liệu')
    expect(en.shrBulkWorkspaceLevel).toBe('All members: {level}')
    expect(vi.shrBulkWorkspaceNone).toBe('Chỉ người được chia sẻ')
    expect(en.shrBulkKeep).toBe('No change')
    expect(vi.shrBulkLinkCreate).toBe('Tạo liên kết mới cho mỗi tài liệu')
    expect(en.shrBulkLinkRevoke).toBe('Turn off every existing link')
    expect(vi.shrBulkLinksCreated).toBe('Liên kết đã tạo')
    expect(en.shrBulkCopyAll).toBe('Copy all')
    expect(vi.shrBulkClose).toBe('Xong')
    expect(vi.shrBulkDone).toBe('Đã chia sẻ {ok}/{total} tài liệu')
    expect(en.shrBulkErrorLine).toBe('{title}: {reason}')
    expect(vi.shrAccessManageFor).toBe('Quản lý quyền truy cập của {title}')
    expect(en.shrAccessViewFor).toBe('View access for {title}')
  })

  it('UNI-2078: the owner transfer copy is the web documents.share.owner.* verbatim', () => {
    const vi = table('vi')
    const en = table('en')
    const web: Array<[string, string, string]> = [
      ['shrOwnerTransferButton', 'Chuyển quyền sở hữu', 'Transfer ownership'],
      [
        'shrOwnerTransferTitle',
        'Chuyển quyền sở hữu “{document}”',
        'Transfer ownership of “{document}”',
      ],
      ['shrOwnerNewOwnerLabel', 'Chủ sở hữu mới', 'New owner'],
      [
        'shrOwnerPreviousLevelLabel',
        'Quyền của {name} sau khi chuyển',
        "{name}'s access after the transfer",
      ],
      ['shrOwnerPreviousLevelNone', 'Không giữ quyền', 'No access'],
      [
        'shrOwnerTransferNote',
        'Chủ sở hữu mới quản lý được tài liệu: chia sẻ, đổi chế độ hiển thị và chuyển vào thùng rác.',
        'The new owner can manage the document: share it, change who can see it and move it to trash.',
      ],
      ['shrOwnerTransferConfirm', 'Chuyển', 'Transfer'],
      [
        'shrOwnerTransferred',
        'Đã chuyển quyền sở hữu cho {name}',
        'Ownership transferred to {name}',
      ],
      [
        'shrOwnerTargetNotMember',
        '{name} chưa là thành viên của workspace này nên không thể làm chủ sở hữu.',
        "{name} isn't a member of this workspace, so they can't own this document.",
      ],
      [
        'shrOwnerSelfTransferError',
        'Quản trị viên không thể tự nhận quyền sở hữu tài liệu riêng tư. Hãy nhờ một quản trị viên khác chuyển, hoặc mở truy cập khẩn cấp để kiểm tra.',
        "Admins can't take ownership of a private document themselves. Ask another admin to transfer it, or open emergency access to inspect it.",
      ],
      ['shrOwnerTitleUntitled', 'Chuyển quyền sở hữu tài liệu', 'Transfer document ownership'],
      ['shrOwnerSearchPlaceholder', 'Tìm thành viên của workspace', 'Search workspace members'],
      [
        'shrOwnerNoCandidates',
        'Không có thành viên nào khác nhận được tài liệu này.',
        'No other member can take this document.',
      ],
      [
        'shrOwnerFailed',
        'Chưa chuyển được quyền sở hữu. Hãy thử lại.',
        "Couldn't transfer ownership. Try again.",
      ],
      [
        'shrOwnerOwnedByWorkProduct',
        'Tài liệu này thuộc về một sản phẩm công việc nên không đổi được chủ sở hữu.',
        "This document belongs to a work product, so its owner can't be changed.",
      ],
    ]
    for (const [key, viText, enText] of web) {
      expect(vi[key], key).toBe(viText)
      expect(en[key], key).toBe(enText)
    }
    // the app's own line for a server without the route
    expect(en.shrOwnerUnavailable).toBeTruthy()
    expect(vi.shrOwnerUnavailable).toBeTruthy()
  })

  // UNI-2078 FE-8b: the de share shard addresses the reader as du; the owner-transfer keys follow it
  it('de owner-transfer strings use the du register, not Sie', () => {
    const formal = /\b(Sie|Ihnen|Ihre[mnrs]?|Ihr)\b/
    expect(
      Object.entries(table('de')).filter(([k, v]) => k.startsWith('shrOwner') && formal.test(v)),
    ).toEqual([])
  })

  it('no git word or internal code in the vi/en copy', () => {
    const text = [...Object.values(table('vi')), ...Object.values(table('en'))].join('\n')
    expect(text).not.toMatch(/\b(git|github|commit|branch)\b/i)
    expect(text).not.toMatch(/\b(GO|UNI)-\d+/)
  })

  it('is registered with the renderer locale table', () => {
    const src = readFileSync(new URL('../src/renderer/src/locale.tsx', import.meta.url), 'utf8')
    expect(src).toContain('uniworkShareStrings')
  })
})
