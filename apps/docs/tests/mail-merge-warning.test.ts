import { describe, expect, it } from 'vitest'
import { mergeWriteWarning } from '../src/renderer/mail-merge/output'
import { en } from '../src/renderer/i18n/app/en'

/**
 * A merge writes ordinary local .docx copies. For a password-protected or a
 * UniWork-bound template the user is asked first: never a silent plaintext copy.
 */
describe('mergeWriteWarning', () => {
  it('a plain local document merges without a question', () => {
    expect(mergeWriteWarning({ encrypted: false }, false)).toBeNull()
    expect(mergeWriteWarning({}, false)).toBeNull()
    expect(mergeWriteWarning(null, false)).toBeNull()
  })

  it('a password-protected document asks, naming the password', () => {
    expect(mergeWriteWarning({ encrypted: true }, false)).toBe('appMergeWarnPassword')
  })

  it('a UniWork-bound document asks, naming UniWork', () => {
    expect(mergeWriteWarning({ encrypted: false }, true)).toBe('appMergeWarnUniwork')
  })

  it('a document that is both asks about the password (the stronger loss)', () => {
    expect(mergeWriteWarning({ encrypted: true }, true)).toBe('appMergeWarnPassword')
  })

  it('both questions exist as app strings', () => {
    expect(en.appMergeWarnPassword).toContain('password')
    expect(en.appMergeWarnUniwork).toContain('UniWork')
  })
})
