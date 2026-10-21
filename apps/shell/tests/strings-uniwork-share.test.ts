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
