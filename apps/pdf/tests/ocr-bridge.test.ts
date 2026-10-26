import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AsyncOcrEngine } from '../../../packages/pdf2docx/src/ocr-chain'
import { ocrPagePng } from '../src/main/ocr'

const FIXTURES = resolve(import.meta.dirname, '../../../packages/pdf2docx/tests/fixtures/ocr')

// the real engine unless a test installs `fake` (the bridge caches whatever the
// resolver returns once, so the wrapper decides per call)
let fake: AsyncOcrEngine | null = null
vi.mock('../../../packages/pdf2docx/src/ocr-local', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../packages/pdf2docx/src/ocr-local')>()
  return {
    ...actual,
    resolveLocalOcrEngineAsync: (...args: Parameters<typeof actual.resolveLocalOcrEngineAsync>) => {
      const real = actual.resolveLocalOcrEngineAsync(...args)
      if (!real) return real
      const engine: AsyncOcrEngine = (png, page) => (fake ?? real)(png, page)
      return engine
    },
  }
})
afterEach(() => {
  fake = null
})

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

describe('viewer OCR bridge serialization (one recognition at a time across windows)', () => {
  const PNG = Buffer.from('png').toString('base64')
  const lineOf = (text: string) => ({
    lines: [{ text, confidence: 1, box: { x0: 0, y0: 0, x1: 1, y1: 1 } }],
  })
  const tick = () => new Promise((r) => setTimeout(r, 40))

  it('starts the second helper only after the first has finished', async () => {
    const events: string[] = []
    let running = 0
    let peak = 0
    let n = 0
    fake = async () => {
      const id = ++n
      events.push(`start${id}`)
      peak = Math.max(peak, ++running)
      await tick() // the first call stays in flight while the second was already requested
      running--
      events.push(`end${id}`)
      return lineOf(`page${id}`)
    }
    const [a, b, c] = await Promise.all([ocrPagePng(PNG), ocrPagePng(PNG), ocrPagePng(PNG)])
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2', 'start3', 'end3'])
    expect(peak).toBe(1)
    // each caller still gets its own page, in order
    expect([a, b, c].map((r) => r![0]!.text)).toEqual(['page1', 'page2', 'page3'])
  })

  it('survives a call whose engine throws: the failure reaches its caller, the queue moves on', async () => {
    const events: string[] = []
    let n = 0
    fake = async () => {
      const id = ++n
      events.push(`start${id}`)
      await tick()
      events.push(`end${id}`)
      if (id === 1) throw new Error('engine blew up')
      return lineOf(`page${id}`)
    }
    const first = ocrPagePng(PNG)
    const second = ocrPagePng(PNG)
    await expect(first).rejects.toThrow('engine blew up')
    expect((await second)![0]!.text).toBe('page2')
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2'])
    // a call made after the failed one is served too
    fake = async () => lineOf('later')
    expect((await ocrPagePng(PNG))![0]!.text).toBe('later')
  })

  it('a failed recognition ([]) does not hold up the queue either', async () => {
    fake = async () => null
    const [a, b] = await Promise.all([ocrPagePng(PNG), ocrPagePng(PNG)])
    expect([a, b]).toEqual([[], []])
  })
})
