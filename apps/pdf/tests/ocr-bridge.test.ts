import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ocrPagePng } from '../src/main/ocr'

const FIXTURES = resolve(import.meta.dirname, '../../../packages/pdf2docx/tests/fixtures/ocr')

describe('viewer OCR bridge (dev layout: bundled Tesseract `vie` first)', () => {
  it('reads a Vietnamese scan with its tone marks and per-glyph boxes', async () => {
    const png = readFileSync(resolve(FIXTURES, 'vi.png')).toString('base64')
    const lines = await ocrPagePng(png)
    expect(lines).not.toBeNull()
    const text = lines!.map((l) => l.text).join('\n')
    expect(text).toContain('Cộng hòa xã hội chủ nghĩa Việt Nam')
    expect(text).toContain('kỹ sư')
    const first = lines!.find((l) => l.text.startsWith('Cộng hòa'))!
    expect(first.chars?.length).toBe([...first.text].length)
    // normalized, origin bottom-left: the title line is near the top of the page
    expect(first.box[3]).toBeGreaterThan(0.8)
  }, 60_000)

  it('returns [] (this image failed) rather than null (no engine) for undecodable input', async () => {
    expect(await ocrPagePng(Buffer.from('not a png').toString('base64'))).toEqual([])
  }, 60_000)

  it('keeps the event loop turning while a recognition runs (the viewer never freezes the main process)', async () => {
    const png = readFileSync(resolve(FIXTURES, 'vi.png')).toString('base64')
    let ticks = 0
    let longestGap = 0
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      longestGap = Math.max(longestGap, now - last)
      last = now
      ticks++
    }, 20)
    const started = performance.now()
    try {
      const lines = await ocrPagePng(png)
      expect(lines!.length).toBeGreaterThan(0)
    } finally {
      clearInterval(timer)
    }
    const elapsed = performance.now() - started
    // a sync spawn would give ~0 ticks and one gap as long as the whole recognition
    expect(elapsed).toBeGreaterThan(300)
    expect(ticks).toBeGreaterThan(elapsed / 20 / 4)
    expect(longestGap).toBeLessThan(elapsed / 2)
  }, 60_000)
})
