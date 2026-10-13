import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { discussionStrings } from '../src/renderer/src/i18n/strings-discussion'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { cloudStrings } from '../src/renderer/src/i18n/strings-cloud'
import { strings } from '../src/renderer/src/strings'

/**
 * Desktop Discussion host shard (i18n/discussion/<lang>.ts): the few host-owned strings of the
 * shell panel (the panel body copy lives in the shared collab kit). zh defines the key set.
 */

const referenceKeys = Object.keys(discussionStrings.zh).sort()
const table = (lang: (typeof LANGS)[number]) => discussionStrings[lang] as Record<string, string>

describe('discussion string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(discussionStrings).sort()).toEqual([...LANGS].sort())
  })

  it('defines the resize separator name', () => {
    expect(referenceKeys).toContain('discussionResizeLabel')
    expect(discussionStrings.en.discussionResizeLabel).toBe('Resize panel')
    expect(discussionStrings.vi.discussionResizeLabel).toBe('Đổi độ rộng bảng')
  })

  it.each([...LANGS])('locale %s has exactly the zh key set, no empty values', (lang) => {
    expect(Object.keys(table(lang)).sort()).toEqual(referenceKeys)
    expect(Object.entries(table(lang)).filter(([, v]) => !v.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s has no repository words or internal codes', (lang) => {
    const bad = Object.values(table(lang)).filter((v) =>
      /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d|\bG8-\d|\bS1[35]\b/i.test(v),
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
          k in syncStrings.zh,
      ),
    ).toEqual([])
  })
})
