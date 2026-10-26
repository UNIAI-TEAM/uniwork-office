import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { docToText, parseFileToText, pptToText, xlsToText } from '../src/index'
import { writeFixture } from './helpers/fixtures'

function legacyFixture(name: string): string {
  return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))
}

describe('parseFileToText: legacy .doc', () => {
  it('extracts body text from a Word 97-2003 document', async () => {
    const result = await parseFileToText(legacyFixture('legacy-sample.doc'))
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('text')
    expect(result.text).toContain('Legacy Report')
    expect(result.text).toContain('Legacy DOC body text')
    expect(result.text).toContain('Second paragraph from Word 97-2003.')
  })

  it('exposes the same text through docToText', async () => {
    const text = await docToText(await readFile(legacyFixture('legacy-sample.doc')))
    expect(text).toContain('Legacy Report')
    expect(text).toContain('Legacy DOC body text')
  })

  it('reads an uppercase .DOC extension through the same path', async () => {
    const path = writeFixture('upper.DOC', await readFile(legacyFixture('legacy-sample.doc')))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('Legacy Report')
  })

  it('rejects a corrupt .doc with an error instead of throwing', async () => {
    const path = writeFixture('corrupt.doc', Buffer.from('not a legacy document'))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('text')
    expect(result.error).toBeTruthy()
  })

  it('rejects an empty .doc with an error instead of throwing', async () => {
    const path = writeFixture('empty.doc', Buffer.alloc(0))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('parseFileToText: legacy .ppt', () => {
  it('extracts one text section per slide from a PowerPoint 97-2003 presentation', async () => {
    const result = await parseFileToText(legacyFixture('legacy-sample.ppt'))
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('text')
    expect(result.text).toContain('## Slide 1')
    expect(result.text).toContain('Legacy PPT title')
    expect(result.text).toContain('First slide body')
    expect(result.text).toContain('## Slide 2')
    expect(result.text).toContain('Second legacy slide')
  })

  it('exposes the same text through pptToText', async () => {
    const text = await pptToText(await readFile(legacyFixture('legacy-sample.ppt')))
    expect(text).toContain('## Slide 1')
    expect(text).toContain('Legacy PPT title')
  })

  it('rejects a corrupt .ppt with an error instead of throwing', async () => {
    const path = writeFixture('corrupt.ppt', Buffer.from('not a legacy document'))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('text')
    expect(result.error).toBeTruthy()
  })

  it('rejects an empty .ppt with an error instead of throwing', async () => {
    const path = writeFixture('empty.ppt', Buffer.alloc(0))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('parseFileToText: legacy .xls', () => {
  it('extracts sheet headings and cell values (including Vietnamese SST strings and RK numbers) from an Excel 97-2003 workbook', async () => {
    const result = await parseFileToText(legacyFixture('vn-budget.xls'))
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('text')
    expect(result.text).toContain('# Data')
    expect(result.text).toContain('Hạng mục | Quý I | Quý II')
    expect(result.text).toContain('Doanh thu | 1250000000 | 780000000')
    expect(result.text).toContain('# Tổng hợp')
    expect(result.text).toContain('Miền Bắc (Hà Nội) | 120 | 150 | 270')
    expect(result.text).toContain('# Ghi chú')
    expect(result.text).toContain('Ghi chú kiểm thử tiếng Việt: ă â đ ê ô ơ ư | 990')
    expect(result.text).toContain('Phê duyệt bởi Phòng Tài chính Kế toán | 2026')
  })

  it('exposes the same text through xlsToText', async () => {
    const text = await xlsToText(await readFile(legacyFixture('vn-budget.xls')))
    expect(text).toContain('# Data')
    expect(text).toContain('# Tổng hợp')
    expect(text).toContain('Miền Bắc (Hà Nội) | 120 | 150 | 270')
  })

  it('reads an uppercase .XLS extension through the same path', async () => {
    const path = writeFixture('upper.XLS', await readFile(legacyFixture('vn-budget.xls')))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('# Tổng hợp')
  })

  it('rejects a corrupt .xls with an error instead of throwing', async () => {
    const path = writeFixture('corrupt.xls', Buffer.from('not a legacy workbook'))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('text')
    expect(result.error).toBeTruthy()
  })

  it('rejects an empty .xls with an error instead of throwing', async () => {
    const path = writeFixture('empty.xls', Buffer.alloc(0))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
