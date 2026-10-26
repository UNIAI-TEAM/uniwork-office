import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  convertedDocumentFor,
  forgetConvertedDocument,
  registerConvertedDocument,
} from '../src/converted-documents'

const temp = join('/tmp', 'genoffice-imports', 'u1', 'Budget.xlsx')
const info = {
  originalPath: '/home/me/Budget.xls',
  suggestSaveAs: '/home/me/Budget.xlsx',
  tempDir: join('/tmp', 'genoffice-imports', 'u1'),
}

describe('converted legacy documents registry', () => {
  afterEach(() => forgetConvertedDocument(temp))

  it('finds a conversion by the exact tab path', () => {
    registerConvertedDocument(temp, info)
    expect(convertedDocumentFor(temp)).toEqual(info)
    // a path spelled with redundant segments is the same file
    expect(
      convertedDocumentFor(join('/tmp', 'genoffice-imports', 'u1', '..', 'u1', 'Budget.xlsx')),
    ).toEqual(info)
  })

  it('never matches by file-name stem: a same-named sibling is another document (R1-4)', () => {
    registerConvertedDocument(temp, info)
    expect(convertedDocumentFor('/home/me/Budget.xlsx')).toBeUndefined()
    expect(
      convertedDocumentFor(join('/tmp', 'genoffice-imports', 'u2', 'Budget.xlsx')),
    ).toBeUndefined()
    expect(convertedDocumentFor('/home/me/Budget.xls')).toBeUndefined()
  })

  it('forgets once the document has a real home', () => {
    registerConvertedDocument(temp, info)
    forgetConvertedDocument(temp)
    expect(convertedDocumentFor(temp)).toBeUndefined()
  })

  it('treats empty and missing paths as ordinary documents', () => {
    expect(convertedDocumentFor(undefined)).toBeUndefined()
    expect(convertedDocumentFor(null)).toBeUndefined()
    expect(convertedDocumentFor('')).toBeUndefined()
    expect(() => forgetConvertedDocument(undefined)).not.toThrow()
  })
})
