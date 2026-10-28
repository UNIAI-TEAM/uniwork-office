import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createI18n } from '@genoffice/i18n'
import { mergeFieldInstruction } from '@genoffice/docx-engine'
import { describe, expect, it } from 'vitest'
import {
  fieldInsertedLabel,
  mergedCountLabel,
  mergeWriteWarning,
  mergeWrittenLabel,
} from '../src/renderer/mail-merge/output'
import { en } from '../src/renderer/i18n/app/en'
import { strings } from '../src/renderer/i18n/strings'

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

describe('fieldInsertedLabel (DOCS-V3)', () => {
  const tr = createI18n(strings)

  it('formats MERGEFIELD instructions as friendly guillemet field names', () => {
    const instr = mergeFieldInstruction('City')
    expect(fieldInsertedLabel(instr)).toBe('«City»')
    expect(tr('en', 'appFieldInserted', { instr: fieldInsertedLabel(instr) })).toBe(
      'Inserted field «City»',
    )
    expect(tr('vi', 'appFieldInserted', { instr: fieldInsertedLabel(instr) })).toBe(
      'Đã chèn trường «City»',
    )
  })

  it('leaves non-merge field codes unchanged', () => {
    expect(fieldInsertedLabel('DATE')).toBe('DATE')
    expect(fieldInsertedLabel('PAGE')).toBe('PAGE')
  })
})

describe('mergedCountLabel and mergeWrittenLabel (DOCS-V4)', () => {
  const tr = createI18n(strings)

  it('selects singular and plural forms in English and Vietnamese', () => {
    expect(mergedCountLabel((k, p) => tr('en', k, p), 'en', 1)).toBe('1 document merged')
    expect(mergedCountLabel((k, p) => tr('en', k, p), 'en', 3)).toBe('3 documents merged')
    expect(mergeWrittenLabel((k, p) => tr('en', k, p), 'en', 1)).toBe('1 document written')
    expect(mergeWrittenLabel((k, p) => tr('en', k, p), 'en', 3)).toBe('3 documents written')
    expect(mergedCountLabel((k, p) => tr('vi', k, p), 'vi', 1)).toBe('Đã trộn 1 tài liệu')
    expect(mergeWrittenLabel((k, p) => tr('vi', k, p), 'vi', 1)).toBe('Đã ghi 1 tài liệu')
  })
})

describe('Mailings CSS rules (DOCS-V1 / DOCS-V2)', () => {
  const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')

  it('scopes generic .modal input away from radio and checkbox controls and gives .mailmerge-radio a 44px coarse target', () => {
    expect(css).toContain(".modal input:not([type='radio']):not([type='checkbox']) {")
    expect(css).toContain(".modal-row input:not([type='radio']):not([type='checkbox']) {")
    expect(css).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.modal label\.protect-check\.mailmerge-radio\s*\{\s*min-height: 44px;/,
    )
  })
})
