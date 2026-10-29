import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertModernSaveTarget,
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

describe('assertModernSaveTarget (R2-2)', () => {
  it('passes a modern or extensionless answer through unchanged', () => {
    expect(assertModernSaveTarget('/home/me/Budget.xlsx', 'xlsx')).toBe('/home/me/Budget.xlsx')
    expect(assertModernSaveTarget('/home/me/Budget', 'xlsx')).toBe('/home/me/Budget')
  })

  it('refuses every legacy and OpenDocument extension, any case, instead of retargeting it', () => {
    for (const name of [
      '/h/A.doc',
      '/h/A.XLS',
      '/h/A.Ppt',
      '/h/A.odt',
      '/h/A.OTT',
      '/h/A.ods',
      '/h/A.OTS',
      '/h/A.odp',
      '/h/A.OTP',
    ]) {
      expect(() => assertModernSaveTarget(name, 'docx')).toThrow(
        "Save it as a .docx file. This app can't save in the original file's format.",
      )
    }
    expect(() => assertModernSaveTarget('/h/A.ods', 'xlsx')).toThrow(
      "Save it as a .xlsx file. This app can't save in the original file's format.",
    )
    expect(() => assertModernSaveTarget('/h/A.ods', 'xlsm')).toThrow(
      "Save it as a .xlsm file. This app can't save in the original file's format.",
    )
    expect(() => assertModernSaveTarget('/h/A.odp', 'pptx')).toThrow(
      "Save it as a .pptx file. This app can't save in the original file's format.",
    )
  })
})
