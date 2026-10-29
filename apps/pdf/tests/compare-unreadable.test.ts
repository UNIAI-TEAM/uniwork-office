// @vitest-environment node
/**
 * An unreadable Compare file shows a translated sentence, not the main process's fixed English
 * reason ('pdf: could not read the document', internal prefix included, the same in every locale).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isCompareUnreadable } from '../src/renderer/compare-text'
import { strings } from '../src/renderer/i18n/strings'

describe('unreadable compare file', () => {
  it('maps the fixed main-process reasons to a translated sentence', () => {
    expect(isCompareUnreadable('pdf: could not read the document')).toBe(true)
    expect(isCompareUnreadable('pdf: path not granted to this view')).toBe(true)
    expect(isCompareUnreadable('anything else')).toBe(false)
  })

  it('keeps the reasons in sync with the main process, which stays path-free', () => {
    const main = readFileSync(
      fileURLToPath(new URL('../src/main/pdf-main.ts', import.meta.url)),
      'utf8',
    )
    expect(main).toContain("reason: 'pdf: could not read the document'")
    expect(main).toContain("reason: 'pdf: path not granted to this view'")
  })

  it('has a sentence in every locale, each in its own words', () => {
    const dicts = strings as Record<string, Record<string, string>>
    const values = Object.entries(dicts).map(([lang, dict]) => [lang, dict.compareUnreadable])
    expect(values.length).toBeGreaterThanOrEqual(20)
    for (const [lang, value] of values) {
      expect(value, lang).toBeTruthy()
      if (lang !== 'en') expect(value, lang).not.toBe(dicts.en!.compareUnreadable)
    }
    expect(dicts.vi!.compareUnreadable).not.toContain('pdf:')
  })
})
