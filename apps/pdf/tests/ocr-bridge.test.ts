import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ocrPagePng } from '../src/main/ocr'

const FIXTURES = resolve(import.meta.dirname, '../../../packages/pdf2docx/tests/fixtures/ocr')

describe('viewer OCR bridge (dev layout: bundled Tesseract `vie` first)', () => {
  it('reads a Vietnamese scan with its tone marks and per-glyph boxes', () => {
    const png = readFileSync(resolve(FIXTURES, 'vi.png')).toString('base64')
    const lines = ocrPagePng(png)
    expect(lines).not.toBeNull()
    const text = lines!.map((l) => l.text).join('\n')
    expect(text).toContain('Cộng hòa xã hội chủ nghĩa Việt Nam')
    expect(text).toContain('kỹ sư')
    const first = lines!.find((l) => l.text.startsWith('Cộng hòa'))!
    expect(first.chars?.length).toBe([...first.text].length)
    // normalized, origin bottom-left: the title line is near the top of the page
    expect(first.box[3]).toBeGreaterThan(0.8)
  }, 60_000)

  it('returns [] (this image failed) rather than null (no engine) for undecodable input', () => {
    expect(ocrPagePng(Buffer.from('not a png').toString('base64'))).toEqual([])
  }, 60_000)
})
