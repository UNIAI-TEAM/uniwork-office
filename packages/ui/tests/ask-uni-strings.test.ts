import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { askUniStrings, askUniText } from '../src/strings-ask-uni'

// The Ask UNI shard of @genoffice/ui: zh defines the key set, en and vi are complete, and the copy
// carries no internal code and no git wording (product rules).

const params = (v: string) => (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join()

describe('Ask UNI ui strings', () => {
  it('has a dictionary for every language', () => {
    for (const lang of LANGS) expect(askUniStrings[lang], lang).toBeDefined()
  })

  it('has the editor-body keys in zh, en and vi', () => {
    const doc = Object.keys(askUniStrings.zh).filter((k) => k.startsWith('askUniDoc'))
    expect(doc.length).toBeGreaterThanOrEqual(12)
    for (const k of doc) {
      for (const lang of ['zh', 'en', 'vi'] as const) {
        expect((askUniStrings[lang] as Record<string, string>)[k], `${lang}.${k}`).toBeTruthy()
      }
    }
  })

  it('keeps the {params} of every key the same across zh, en and vi', () => {
    for (const [k, z] of Object.entries(askUniStrings.zh)) {
      for (const lang of ['en', 'vi'] as const) {
        const v = (askUniStrings[lang] as Record<string, string>)[k]!
        expect(params(v), `${lang}.${k}`).toBe(params(z))
      }
    }
  })

  it('names no internal code, no git and no hosting service in en, vi or zh', () => {
    for (const lang of ['zh', 'en', 'vi'] as const) {
      for (const [k, v] of Object.entries(askUniStrings[lang])) {
        expect(v, `${lang}.${k}`).not.toMatch(/\bUNI-\d|\bGO-\d|github|\bgit\b/i)
      }
    }
  })

  it('falls back to English for a key a locale has not been given yet', () => {
    expect(askUniText('de', 'askUniDocNewChat')).toBeTruthy()
  })
})
