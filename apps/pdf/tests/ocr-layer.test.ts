import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  AUTO_OCR_PAGE_CAP,
  buildOcrPageData,
  OcrTextLayer,
  runAutoOcr,
} from '../src/renderer/ocr-layer'
import type { OcrPageData } from '../src/renderer/ocr-layer'
import type { PdfOcrLine } from '../src/shared/ipc'
import { createSearchIndexCache, searchInIndex } from '../src/renderer/search'
import type { SearchIndex, SearchIndexCache } from '../src/renderer/search'
import * as textWrap from '../src/renderer/text-wrap'
const GEOM = { pw: 600, ph: 800, rot: 0 }

const box = (x0: number, x1: number): [number, number, number, number] => [x0, 0.8, x1, 0.85]
const SEPARATOR: [number, number, number, number] = [0, 1, 0, 1]

describe('buildOcrPageData word joining', () => {
  it('keeps CJK characters unspaced so search matches the query as typed', () => {
    const line: PdfOcrLine = {
      text: '使用价值',
      confidence: 1,
      box: box(0.1, 0.5),
      chars: [
        { text: '使', box: box(0.1, 0.2) },
        { text: '用', box: box(0.2, 0.3) },
        { text: '价', box: box(0.3, 0.4) },
        { text: '值', box: box(0.4, 0.5) },
      ],
    }
    const data = buildOcrPageData([line], GEOM)!
    expect(data.entry.text).toBe('使用价值\n')
    expect(data.entry.lower.includes('使用价值')).toBe(true)
    expect(data.words.map((w) => w.text)).toEqual(['使', '用', '价', '值'])
    expect(data.words.every((w) => !w.spaceAfter)).toBe(true)
  })

  it('keeps a single space where the OCR stream had a separator', () => {
    const line: PdfOcrLine = {
      text: 'hello world',
      confidence: 1,
      box: box(0.1, 0.6),
      chars: [
        ...[...'hello'].map((t) => ({ text: t, box: box(0.1, 0.3) })),
        { text: ' ', box: SEPARATOR },
        ...[...'world'].map((t) => ({ text: t, box: box(0.35, 0.6) })),
      ],
    }
    const data = buildOcrPageData([line], GEOM)!
    expect(data.entry.text).toBe('hello world\n')
    expect(data.words.map((w) => w.text)).toEqual(['hello', 'world'])
    expect(data.words[0]!.spaceAfter).toBe(true)
    expect(data.words[1]!.spaceAfter).toBe(true)
  })

  it('drops Windows-style segmentation separators between CJK words', () => {
    // Windows OcrLine.Text space-joins its CJK words; the helper marks those
    // separators with zero boxes. They must not become spaces in the index.
    const line: PdfOcrLine = {
      text: '使用 价值',
      confidence: 1,
      box: box(0.1, 0.5),
      chars: [
        { text: '使', box: box(0.1, 0.2) },
        { text: '用', box: box(0.2, 0.3) },
        { text: ' ', box: [0, 0, 0, 0] },
        { text: '价', box: box(0.3, 0.4) },
        { text: '值', box: box(0.4, 0.5) },
      ],
    }
    const data = buildOcrPageData([line], GEOM)!
    expect(data.entry.text).toBe('使用价值\n')
  })

  it('keeps real Korean word spaces (Hangul is space-delimited)', () => {
    const line: PdfOcrLine = {
      text: '사용 가치',
      confidence: 1,
      box: box(0.1, 0.5),
      chars: [
        { text: '사', box: box(0.1, 0.15) },
        { text: '용', box: box(0.15, 0.2) },
        { text: ' ', box: SEPARATOR },
        { text: '가', box: box(0.25, 0.3) },
        { text: '치', box: box(0.3, 0.35) },
      ],
    }
    const data = buildOcrPageData([line], GEOM)!
    expect(data.entry.text).toBe('사용 가치\n')
    expect(data.words[data.words.length - 1]!.spaceAfter).toBe(true)
  })

  it('keeps the space on a CJK/Latin boundary', () => {
    const line: PdfOcrLine = {
      text: '对比 Windows 系统',
      confidence: 1,
      box: box(0.1, 0.7),
      chars: [
        { text: '对', box: box(0.1, 0.15) },
        { text: '比', box: box(0.15, 0.2) },
        { text: ' ', box: SEPARATOR },
        ...[...'Windows'].map((t) => ({ text: t, box: box(0.25, 0.45) })),
        { text: ' ', box: SEPARATOR },
        { text: '系', box: box(0.5, 0.55) },
        { text: '统', box: box(0.55, 0.6) },
      ],
    }
    const data = buildOcrPageData([line], GEOM)!
    expect(data.entry.text).toBe('对比 Windows 系统\n')
  })

  it('no-space rule follows the shared script table: thai suppressed, fullwidth punct line-end', () => {
    const thai: PdfOcrLine = {
      text: 'มูลค่า การใช้',
      confidence: 1,
      box: box(0.1, 0.5),
      chars: [
        ...[...'มูลค่า'].map((t) => ({ text: t, box: box(0.1, 0.2) })),
        { text: ' ', box: [0, 0, 0, 0] as [number, number, number, number] },
        ...[...'การใช้'].map((t) => ({ text: t, box: box(0.25, 0.35) })),
      ],
    }
    const punct: PdfOcrLine = {
      text: '确认！',
      confidence: 1,
      box: box(0.1, 0.3),
      chars: [
        { text: '确', box: box(0.1, 0.15) },
        { text: '认', box: box(0.15, 0.2) },
        { text: '！', box: box(0.2, 0.25) },
      ],
    }
    const data = buildOcrPageData([thai, punct], GEOM)!
    expect(data.entry.text).toBe('มูลค่าการใช้\n确认！\n')
    expect(data.words[data.words.length - 1]!.spaceAfter).toBe(false)
  })

  it('offsets in index items match the joined text', () => {
    const line: PdfOcrLine = {
      text: '第一篇 商品',
      confidence: 1,
      box: box(0.1, 0.7),
      chars: [
        { text: '第', box: box(0.1, 0.2) },
        { text: '一', box: box(0.2, 0.3) },
        { text: '篇', box: box(0.3, 0.4) },
        { text: ' ', box: SEPARATOR },
        { text: '商', box: box(0.45, 0.55) },
        { text: '品', box: box(0.55, 0.65) },
      ],
    }
    // the Han|Han separator is dropped (queries are typed without it)
    const data = buildOcrPageData([line], GEOM)!
    expect(data.entry.text).toBe('第一篇商品\n')
    for (const item of data.entry.items) {
      expect(data.entry.text.slice(item.start, item.end).trim().length).toBeGreaterThan(0)
    }
    const shang = data.entry.items[3]!
    expect(data.entry.text.slice(shang.start, shang.end)).toBe('商')
  })

  it('folds case length-preservingly so OCR offsets agree with text-layer search (genoffice#1130)', () => {
    const line: PdfOcrLine = {
      text: '\u0130stanbul Ankara',
      confidence: 1,
      box: box(0.1, 0.9),
      chars: [
        { text: '\u0130stanbul', box: box(0.1, 0.5) },
        { text: ' ', box: SEPARATOR },
        { text: 'Ankara', box: box(0.55, 0.9) },
      ],
    }
    const data = buildOcrPageData([line], GEOM)!
    expect(data.entry.lower.length).toBe(data.entry.text.length)
    const dotted = searchInIndex([data.entry], '\u0130stanbul')
    expect(dotted).toHaveLength(1)
    const ankara = searchInIndex([data.entry], 'ankara')
    expect(ankara).toHaveLength(1)
    const ankaraItem = data.entry.items[1]!
    expect(ankara[0]!.rects[0]![0]).toBeCloseTo(ankaraItem.x, 5)
  })

  it('merges per-glyph Vietnamese chars (including decomposed symbol splits) and matches shared-box words', () => {
    // Per-glyph line (Tesseract alignChars convention): each glyph has its own box
    // and varying vertical extents (ascenders/diacritics vs x-height), plus a symbol
    // that normalized to two code points with evenly split boxes ('o\u0302' -> 'ô' or multi-char cluster).
    const lineBox: [number, number, number, number] = [0.1, 0.8, 0.45, 0.84]
    const perGlyphLine: PdfOcrLine = {
      text: 'Cộng hòa',
      confidence: 0.96,
      box: lineBox,
      chars: [
        { text: 'C', box: [0.1, 0.805, 0.13, 0.835] },
        // Decomposed symbol case: engine split a two-char cluster across [0.13, 0.19]
        { text: 'ộ', box: [0.13, 0.8, 0.16, 0.84] },
        { text: 'n', box: [0.16, 0.808, 0.19, 0.828] },
        { text: 'g', box: [0.19, 0.798, 0.22, 0.828] },
        { text: ' ', box: [0, 0, 0, 0] },
        { text: 'h', box: [0.26, 0.805, 0.29, 0.838] },
        { text: 'ò', box: [0.29, 0.808, 0.32, 0.839] },
        { text: 'a', box: [0.32, 0.808, 0.35, 0.828] },
      ],
    }
    // Shared-box line (Vision / Windows convention): chars of each word share the word box
    const sharedBoxLine: PdfOcrLine = {
      text: 'Cộng hòa',
      confidence: 0.96,
      box: lineBox,
      chars: [
        ...[...'Cộng'].map((t) => ({
          text: t,
          box: [0.1, 0.802, 0.22, 0.838] as [number, number, number, number],
        })),
        { text: ' ', box: SEPARATOR },
        ...[...'hòa'].map((t) => ({
          text: t,
          box: [0.26, 0.805, 0.35, 0.839] as [number, number, number, number],
        })),
      ],
    }

    const perGlyph = buildOcrPageData([perGlyphLine], GEOM)!
    const shared = buildOcrPageData([sharedBoxLine], GEOM)!

    expect(perGlyph.words.map((w) => w.text)).toEqual(['Cộng', 'hòa'])
    expect(shared.words.map((w) => w.text)).toEqual(['Cộng', 'hòa'])
    expect(perGlyph.entry.text).toBe('Cộng hòa\n')
    expect(shared.entry.text).toBe('Cộng hòa\n')
    expect(perGlyph.words.map((w) => w.rect)).toEqual(shared.words.map((w) => w.rect))
    expect(perGlyph.entry.items).toEqual(shared.entry.items)
    // Both words take the line's vertical extent [0.8 * 800, 0.84 * 800] = [640, 672]
    for (const w of perGlyph.words) {
      expect(w.rect[1]).toBeCloseTo(640, 5)
      expect(w.rect[3]).toBeCloseTo(672, 5)
    }
  })

  it('lays out the real Tesseract Vietnamese biên bản page with word-level boxes and line heights (UNI-2201)', () => {
    const fixturePath = join(__dirname, 'fixtures/ocr-tesseract-vi-bien-ban.json')
    const rawLines = JSON.parse(readFileSync(fixturePath, 'utf8')) as PdfOcrLine[]
    expect(rawLines.length).toBeGreaterThanOrEqual(17)

    const a4Geom = { pw: 595.28, ph: 841.89, rot: 0 }
    const fullData = buildOcrPageData(rawLines, a4Geom)!
    expect(fullData).not.toBeNull()

    const text = fullData.entry.text
    expect(text).toBe(text.normalize('NFC'))
    expect(text).toContain('Cộng hòa')
    expect(text).toContain('Độc lập')
    expect(text).toContain('chủ nghĩa')
    expect(text).toContain('Nguyễn Văn Thắng')

    // Check every line individually: word count matches printed words (not per-glyph),
    // all words of a line share top/height, and word rects lie inside the line box in
    // left-to-right order without overlap.
    let totalWords = 0
    for (const line of rawLines) {
      const lineData = buildOcrPageData([line], a4Geom)!
      expect(lineData).not.toBeNull()
      expect(lineData.entry.items.length).toBeGreaterThan(0)

      const printedWords = line.text.trim().split(/\s+/)
      expect(lineData.words).toHaveLength(printedWords.length)
      expect(lineData.words.map((w) => w.text)).toEqual(printedWords)

      const lineY0 = line.box[1] * a4Geom.ph
      const lineY1 = line.box[3] * a4Geom.ph
      const lineX0 = line.box[0] * a4Geom.pw
      const lineX1 = line.box[2] * a4Geom.pw

      for (let i = 0; i < lineData.words.length; i++) {
        const w = lineData.words[i]!
        const it = lineData.entry.items[i]!
        // Word rect and search index item rect match and share the line's y-range
        expect(w.rect[1]).toBeCloseTo(lineY0, 4)
        expect(w.rect[3]).toBeCloseTo(lineY1, 4)
        expect(it.y).toBeCloseTo(lineY0, 4)
        expect(it.h).toBeCloseTo(lineY1 - lineY0, 4)
        expect(it.x).toBeCloseTo(w.rect[0], 4)
        expect(it.w).toBeCloseTo(w.rect[2] - w.rect[0], 4)
        // Inside the line box horizontally
        expect(w.rect[0]).toBeGreaterThanOrEqual(lineX0 - 1e-3)
        expect(w.rect[2]).toBeLessThanOrEqual(lineX1 + 1e-3)
        expect(w.rect[2]).toBeGreaterThan(w.rect[0])
        // Left-to-right without overlap
        if (i > 0) {
          const prev = lineData.words[i - 1]!
          expect(w.rect[0]).toBeGreaterThanOrEqual(prev.rect[2] - 1e-3)
        }
      }
      totalWords += lineData.words.length
    }
    expect(fullData.words).toHaveLength(totalWords)
    expect(fullData.entry.items).toHaveLength(totalWords)
  })

  it('renders OcrTextLayer spans of a line with identical top and fontSize', () => {
    const spy = vi
      .spyOn(textWrap, 'measurePt')
      .mockImplementation((text, fontPx) => [...text].length * fontPx * 0.55)
    try {
      const line: PdfOcrLine = {
        text: 'Cộng hòa xã hội',
        confidence: 0.96,
        box: [0.1, 0.8, 0.5, 0.82],
        chars: [
          { text: 'C', box: [0.1, 0.803, 0.12, 0.818] },
          { text: 'ộ', box: [0.12, 0.8, 0.14, 0.82] },
          { text: 'n', box: [0.14, 0.803, 0.16, 0.814] },
          { text: 'g', box: [0.16, 0.798, 0.18, 0.814] },
          { text: ' ', box: [0, 0, 0, 0] },
          { text: 'h', box: [0.2, 0.803, 0.22, 0.819] },
          { text: 'ò', box: [0.22, 0.803, 0.24, 0.819] },
          { text: 'a', box: [0.24, 0.803, 0.26, 0.814] },
          { text: ' ', box: [0, 0, 0, 0] },
          { text: 'x', box: [0.28, 0.803, 0.3, 0.814] },
          { text: 'ã', box: [0.3, 0.803, 0.32, 0.819] },
          { text: ' ', box: [0, 0, 0, 0] },
          { text: 'h', box: [0.34, 0.803, 0.36, 0.819] },
          { text: 'ộ', box: [0.36, 0.8, 0.38, 0.82] },
          { text: 'i', box: [0.38, 0.803, 0.4, 0.819] },
        ],
      }
      const data = buildOcrPageData([line], GEOM)!
      const html = renderToStaticMarkup(
        createElement(OcrTextLayer, { data, geom: GEOM, scale: 1.5 }),
      )
      const container = document.createElement('div')
      container.innerHTML = html
      const spans = [...container.querySelectorAll('.pdf-ocr-layer span')] as HTMLSpanElement[]
      expect(spans).toHaveLength(4)
      expect(spans.map((s) => s.textContent)).toEqual(['Cộng ', 'hòa ', 'xã ', 'hội '])
      const tops = new Set(spans.map((s) => s.style.top))
      const fontSizes = new Set(spans.map((s) => s.style.fontSize))
      expect(tops.size).toBe(1)
      expect(fontSizes.size).toBe(1)
      // Line height is (0.82 - 0.8) * 800 * 1.5 = 24px; top is (1 - 0.82) * 800 * 1.5 = 216px
      expect(spans[0]!.style.top).toBe('216px')
      expect(spans[0]!.style.fontSize).toBe('24px')
      expect(spy).toHaveBeenCalledWith('Cộng', 24, 'sans-serif')
    } finally {
      spy.mockRestore()
    }
  })
})

/** A document whose pages carry no text (scanned) unless `texts[i]` is set.
    Counts text extractions so the pass can be checked for reusing the shared index. */
function scannedDoc(
  count: number,
  texts: (string | null)[] = [],
): { doc: PDFDocumentProxy; extractions: number[] } {
  const extractions: number[] = []
  const doc = {
    numPages: count,
    getPage: async (n: number) => {
      extractions.push(n)
      const text = texts[n - 1] ?? null
      return {
        getTextContent: async () => ({
          items:
            text === null
              ? []
              : [{ str: text, transform: [1, 0, 0, 1, 0, 700], width: 10, height: 12 }],
        }),
      }
    },
  } as unknown as PDFDocumentProxy
  return { doc, extractions }
}

const LINE: PdfOcrLine = { text: 'recognized', confidence: 1, box: [0.1, 0.8, 0.9, 0.85] }

/** Drive the pass with fakes: the renderer and the platform engine are injected,
    so the loop itself (order, cap, cancel, reporting) is what gets exercised. */
async function runPass(
  doc: PDFDocumentProxy,
  opts: {
    fromPage?: number
    /** The queue a continued pass walks (see `result.pending`) */
    pending?: readonly number[]
    limit?: number
    cache?: SearchIndexCache
    signal?: AbortSignal
    abortAfter?: (calls: number, controller: AbortController) => void
    engine?: (calls: number) => PdfOcrLine[] | null
    render?: () => Promise<string | null>
  },
) {
  const controller = new AbortController()
  const recognized: number[] = []
  /** What `onPage` handed over, keyed the way the app keys its OCR page map */
  const pages = new Map<number, OcrPageData>()
  const progress: [number, number][] = []
  let engineCalls = 0
  const result = await runAutoOcr({
    doc,
    cache: opts.cache ?? createSearchIndexCache(),
    fromPage: () => opts.fromPage ?? 0,
    signal: opts.signal ?? controller.signal,
    ...(opts.pending === undefined ? {} : { pending: opts.pending }),
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
    geom: () => GEOM,
    render: opts.render ?? (async () => 'png'),
    ocrPage: async () => {
      engineCalls += 1
      opts.abortAfter?.(engineCalls, controller)
      return opts.engine ? opts.engine(engineCalls) : [LINE]
    },
    onPage: (origIdx, data) => {
      recognized.push(origIdx)
      pages.set(origIdx, data)
    },
    onProgress: (done, total) => progress.push([done, total]),
  })
  return { result, recognized, pages, progress, engineCalls }
}

const span = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i)

describe('runAutoOcr', () => {
  it('stops at the page cap and reports the pages it left unrecognized', async () => {
    // 100 scanned pages with the default cap: recognition must not run to the end
    const { doc } = scannedDoc(100)
    const { result, engineCalls } = await runPass(doc, {})
    expect(result.stop).toBe('cap')
    expect(result.total).toBe(100)
    expect(result.done).toBe(AUTO_OCR_PAGE_CAP)
    expect(result.remaining).toBe(100 - AUTO_OCR_PAGE_CAP)
    expect(engineCalls).toBe(AUTO_OCR_PAGE_CAP)
  })

  it('holds the cap when no page renders, so a broken file cannot run away', async () => {
    const { doc } = scannedDoc(100)
    const { result, engineCalls } = await runPass(doc, { render: async () => null })
    expect(result.stop).toBe('cap')
    expect(result.done).toBe(0)
    expect(result.remaining).toBe(100 - AUTO_OCR_PAGE_CAP)
    expect(engineCalls).toBe(0)
  })

  it('stops when the user cancels, keeping the page already paid for', async () => {
    const { doc } = scannedDoc(50)
    const { result, recognized, engineCalls } = await runPass(doc, {
      abortAfter: (_calls, controller) => controller.abort(),
    })
    expect(result.stop).toBe('cancelled')
    expect(result.done).toBe(1)
    expect(result.remaining).toBe(49)
    expect(recognized).toEqual([0])
    expect(engineCalls).toBe(1)
  })

  it('extracts the document text once when the index is already cached', async () => {
    // search / paragraph boxes / AI built the index first; the pass must reuse it
    const { doc, extractions } = scannedDoc(3)
    const cache = createSearchIndexCache()
    await cache.get(doc)
    expect(extractions).toEqual([1, 2, 3])
    const { result } = await runPass(doc, { cache })
    expect(result.stop).toBe('complete')
    expect(result.done).toBe(3)
    expect(extractions).toEqual([1, 2, 3])
  })

  it('visits scanned pages from the current page and wraps around', async () => {
    const { doc } = scannedDoc(4)
    const { result, recognized } = await runPass(doc, { fromPage: 2 })
    expect(result.stop).toBe('complete')
    expect(recognized).toEqual([2, 3, 0, 1])
  })

  it('recognizes only the scanned pages of a mixed document', async () => {
    const { doc } = scannedDoc(3, [
      'a page of born-digital text here',
      null,
      'more real text on this page',
    ])
    const { result, recognized } = await runPass(doc, {})
    expect(result.stop).toBe('complete')
    expect(result.total).toBe(1)
    expect(recognized).toEqual([1])
  })

  it('stops at the first null answer: no OCR engine on this platform', async () => {
    const { doc } = scannedDoc(20)
    const { result, engineCalls } = await runPass(doc, {
      engine: () => null,
    })
    expect(result.stop).toBe('noEngine')
    expect(engineCalls).toBe(1)
  })

  it('reports the page totals as it goes, before the first page lands', async () => {
    const { doc } = scannedDoc(3)
    const { progress } = await runPass(doc, {})
    expect(progress[0]).toEqual([0, 3])
    expect(progress[progress.length - 1]).toEqual([2, 3])
  })

  it('resumes at the page the cap stopped on, so the far pages become searchable', async () => {
    // 100 scanned pages under the 40-page cap: the pass has to be continued
    // three times, and each continuation must pick up at the page the cap cut
    // it on rather than at page 1, or the tail is never recognized
    const { doc } = scannedDoc(100)
    const cache = createSearchIndexCache()
    const ocrPages = new Map<number, OcrPageData>()

    const first = await runPass(doc, { cache })
    expect(first.result.stop).toBe('cap')
    expect(first.result.pending).toEqual(span(AUTO_OCR_PAGE_CAP, 100 - AUTO_OCR_PAGE_CAP))
    expect(first.recognized).toEqual(span(0, AUTO_OCR_PAGE_CAP))

    const second = await runPass(doc, { cache, pending: first.result.pending ?? [] })
    expect(second.result.stop).toBe('cap')
    expect(second.result.pending).toEqual(span(AUTO_OCR_PAGE_CAP * 2, 100 - AUTO_OCR_PAGE_CAP * 2))
    expect(second.recognized).toEqual(span(AUTO_OCR_PAGE_CAP, AUTO_OCR_PAGE_CAP))

    const third = await runPass(doc, { cache, pending: second.result.pending ?? [] })
    expect(third.result.stop).toBe('complete')
    expect(third.result.pending).toBeNull()
    expect(third.recognized).toEqual(span(AUTO_OCR_PAGE_CAP * 2, 100 - AUTO_OCR_PAGE_CAP * 2))

    // no page was paid for twice, and no page was skipped on the way round
    const visited = [...first.recognized, ...second.recognized, ...third.recognized]
    expect(visited).toHaveLength(100)
    expect(new Set(visited).size).toBe(100)

    // the pages past the cap are searchable once the pass has been continued
    for (const pass of [first, second, third]) {
      for (const [origIdx, data] of pass.pages) ocrPages.set(origIdx, data)
    }
    const base = await cache.get(doc)
    const merged: SearchIndex = base.map((entry, i) => ocrPages.get(i)?.entry ?? entry)
    const hits = new Set(searchInIndex(merged, 'recognized').map((m) => m.pageIndex))
    expect(hits.has(AUTO_OCR_PAGE_CAP)).toBe(true)
    expect(hits.has(99)).toBe(true)
  })

  it('continues the wrap-around order instead of re-paying for the pages it wrapped past', async () => {
    // Reading near the end of a long scan rotates the order, so the pages after
    // the anchor come first. A continuation that re-rotated from the current
    // page would drop the wrapped tail and re-pay for the pages before it
    const { doc } = scannedDoc(100)
    const cache = createSearchIndexCache()
    const first = await runPass(doc, { cache, fromPage: 90, limit: 40 })
    expect(first.result.stop).toBe('cap')
    expect(first.recognized).toEqual([...span(90, 10), ...span(0, 30)])

    const second = await runPass(doc, { cache, pending: first.result.pending ?? [] })
    expect(second.result.stop).toBe('cap')
    expect(second.recognized).toEqual(span(30, 40))

    const third = await runPass(doc, { cache, pending: second.result.pending ?? [] })
    expect(third.result.stop).toBe('complete')
    // 90-99 were recognized by the first pass before it wrapped, so the tail
    // ends at 89 and they are not paid for a second time
    expect(third.recognized).toEqual(span(70, 20))

    const visited = [...first.recognized, ...second.recognized, ...third.recognized]
    expect(visited).toHaveLength(100)
    expect(new Set(visited).size).toBe(100)
  })

  it('stops a continued pass whose old signal was aborted in between', async () => {
    // The cap is a pause, not a cancel, so a continuation reuses the finished
    // pass's signal. If that signal was torn down in the meantime it is already
    // aborted, and handing it over would cancel the pass before its first page
    const { doc } = scannedDoc(100)
    const controller = new AbortController()
    controller.abort()
    const { result, engineCalls } = await runPass(doc, {
      signal: controller.signal,
      pending: span(40, 60),
    })
    expect(result.stop).toBe('cancelled')
    expect(result.done).toBe(0)
    expect(engineCalls).toBe(0)
  })
})
