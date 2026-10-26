/**
 * OCR text layer for scanned pages (issue #119): the platform system engine
 * returns line/word boxes; this module converts them into (a) a synthetic,
 * selectable transparent text overlay and (b) a PageEntry that patches the
 * search index — everything downstream (search, selection quads, markups,
 * AI tools) then works on scanned pages unchanged.
 *
 * Word boxes are stored in PDF user space (like markups), so unsaved page
 * rotations re-project them instead of invalidating the recognition.
 */
import type { ReactElement } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfOcrLine } from '../shared/ipc'
import { geomDispSize, pdfRectToCss, viewToPdf } from './annotations'
import type { PageGeom } from './annotations'
import type { PageEntry } from './search'
import type { SearchIndexCache } from './search'
import { measurePt } from './text-wrap'
import { foldCase } from '@genoffice/ui'
import { isNoSpaceScript, scriptOf } from '../../../../packages/pdf2docx/src/script'

export interface OcrWord {
  text: string
  /** PDF user space [x1,y1,x2,y2] */
  rect: [number, number, number, number]
  /** Render a space after this word so DOM copy keeps real word gaps */
  spaceAfter: boolean
}

export interface OcrPageData {
  entry: PageEntry
  words: OcrWord[]
}

/** Vision emits degenerate boxes for separators (spaces): full-image or zero-width */
const isSeparatorBox = (b: [number, number, number, number]): boolean =>
  b[2] - b[0] <= 0 || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 1)

/** Ignore noise the engine is unsure about (stray marks, bleed-through) */
const MIN_LINE_CONFIDENCE = 0.3

/** normalized bottom-left box (relative to the rendered display image) → display-space box at scale 1 */
function boxToDisp(
  b: [number, number, number, number],
  disp: { width: number; height: number },
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: b[0] * disp.width,
    top: (1 - b[3]) * disp.height,
    right: b[2] * disp.width,
    bottom: (1 - b[1]) * disp.height,
  }
}

function dispToPdfRect(
  geom: PageGeom,
  d: { left: number; top: number; right: number; bottom: number },
): [number, number, number, number] {
  const [ax, ay] = viewToPdf(geom, d.left, d.top)
  const [bx, by] = viewToPdf(geom, d.right, d.bottom)
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
}

interface LineWord {
  text: string
  box: [number, number, number, number]
  /** A real separator (space) preceded this word in the OCR stream. CJK scripts
      emit one word per character with no separators — joining them with spaces
      would corrupt the searchable text (`使 用 价 值` never matches `使用价值`). */
  gap: boolean
}

/** Below these thresholds, vertical scatter across words comes from ascender/descender
    differences or minor scan jitter rather than a tilted line, so every word keeps the
    shared line box [ly0, ly1]. Above them (at least 3 words, width-weighted x-spread
    >= 25 % of line width, and fitted rise >= 30 % of line height), words follow a
    width-weighted least-squares tilt line with one shared band height per line. */
const TILT_MIN_WORDS = 3
const TILT_MIN_X_SPREAD_RATIO = 0.25
const TILT_RISE_RATIO = 0.3

/** Split one OCR line into words: runs of chars between separators (degenerate
    box or whitespace), with x-extent = union of the word's char boxes and
    y-extent = the line box on straight lines (or a tilted band of uniform height
    when the line is skewed). Both shared-box engines (Vision / Windows) and
    per-glyph engines (Tesseract alignChars) merge space-delimited words under
    the union rule. No-space scripts (CJK / Kana / Thai) emit one char per box
    with no separators: when consecutive chars do not share an identical box and
    either side is a no-space script, each char stays its own word so `data.words`
    and per-char search item offsets remain unchanged. Whole-line fallback when
    chars are absent or incomplete. */
function lineWords(line: PdfOcrLine): LineWord[] {
  if (!line.chars || line.chars.length === 0) {
    const text = line.text.trim()
    return text ? [{ text, box: line.box, gap: false }] : []
  }
  const words: LineWord[] = []
  let cur: LineWord | null = null
  let curHasInRange = false
  let curFallbackBox: [number, number, number, number] = line.box
  let prevRawX0 = NaN
  let prevRawX2 = NaN
  let curLastChar = ''
  let sep = false
  const [lx0, , lx1] = line.box
  const clampWordBox = (b: [number, number, number, number]): [number, number, number, number] => {
    const lineW = Math.max(0, lx1 - lx0)
    const minW = Math.max(1e-3, lineW * 0.005)
    const rawW = Math.max(minW, b[2] - b[0])
    if (lineW <= 0) return [lx0, b[1], lx0 + minW, b[3]]
    const w = Math.min(lineW, Math.max(minW, Math.min(lx1, b[2]) - Math.max(lx0, b[0]), rawW))
    const x0 = Math.max(lx0, Math.min(lx1 - w, b[0]))
    return [x0, b[1], x0 + w, b[3]]
  }
  const flushCur = (): void => {
    if (!cur) return
    if (!curHasInRange) cur.box = clampWordBox(curFallbackBox)
    words.push(cur)
    cur = null
  }
  for (const c of line.chars) {
    if (isSeparatorBox(c.box) || c.text.trim() === '') {
      flushCur()
      sep = true
      continue
    }
    // A glyph box outside the line's x-range (italic overhang, stray helper box) keeps its
    // text in the word without seeding or stretching the word union; if no in-range glyph
    // ever arrives in the word, flushCur clamps curFallbackBox inside [lx0, lx1].
    const inLineX = c.box[0] >= lx0 - 1e-3 && c.box[2] <= lx1 + 1e-3
    const sameBox = cur !== null && c.box[0] === prevRawX0 && c.box[2] === prevRawX2
    const canMerge =
      cur !== null && (sameBox || (!endsNoSpaceScript(curLastChar) && !startsNoSpaceScript(c.text)))
    if (cur && canMerge) {
      cur.text += c.text
      if (inLineX) {
        if (!curHasInRange) {
          cur.box = [c.box[0], c.box[1], c.box[2], c.box[3]]
          curHasInRange = true
        } else {
          cur.box[0] = Math.min(cur.box[0], c.box[0])
          cur.box[1] = Math.min(cur.box[1], c.box[1])
          cur.box[2] = Math.max(cur.box[2], c.box[2])
          cur.box[3] = Math.max(cur.box[3], c.box[3])
        }
      }
      curLastChar = c.text
      prevRawX0 = c.box[0]
      prevRawX2 = c.box[2]
    } else {
      flushCur()
      cur = {
        text: c.text,
        box: [c.box[0], c.box[1], c.box[2], c.box[3]],
        gap: sep,
      }
      curHasInRange = inLineX
      curFallbackBox = [c.box[0], c.box[1], c.box[2], c.box[3]]
      curLastChar = c.text
      prevRawX0 = c.box[0]
      prevRawX2 = c.box[2]
      sep = false
    }
  }
  flushCur()
  if (words.length === 0) return []
  const checked = lineWordsFallback(words, line)
  if (checked !== words) return checked
  applyLineVerticalBand(words, line.box)
  return words
}

/** Assign vertical bounds to each word on a line: straight lines share [ly0, ly1]
    across all words; tilted lines fit a width-weighted least-squares centre line
    and give every word the same band height h centered on the fitted line (clamped
    to [ly0, ly1]) so spans follow the tilt without overlapping adjacent lines. */
function applyLineVerticalBand(words: LineWord[], lineBox: [number, number, number, number]): void {
  const [lx0, ly0, lx1, ly1] = lineBox
  const lineH = ly1 - ly0
  const lineW = lx1 - lx0
  if (words.length >= TILT_MIN_WORDS && lineH > 0 && lineW > 0) {
    let sw = 0
    let sx = 0
    let sy = 0
    for (const w of words) {
      const wt = Math.max(w.box[2] - w.box[0], 1e-6)
      sw += wt
      sx += wt * 0.5 * (w.box[0] + w.box[2])
      sy += wt * 0.5 * (w.box[1] + w.box[3])
    }
    const mx = sx / sw
    const my = sy / sw
    let sxx = 0
    let sxy = 0
    for (const w of words) {
      const wt = Math.max(w.box[2] - w.box[0], 1e-6)
      const dx = 0.5 * (w.box[0] + w.box[2]) - mx
      const dy = 0.5 * (w.box[1] + w.box[3]) - my
      sxx += wt * dx * dx
      sxy += wt * dx * dy
    }
    const xSpread = Math.sqrt(sxx / sw)
    const slope = sxx > 1e-12 ? sxy / sxx : 0
    const rise = Math.abs(slope) * lineW
    if (xSpread >= TILT_MIN_X_SPREAD_RATIO * lineW && rise >= TILT_RISE_RATIO * lineH) {
      const heights = words.map((w) => w.box[3] - w.box[1]).sort((a, b) => a - b)
      const medianH = heights[Math.floor(heights.length / 2)]!
      const h = Math.min(lineH, Math.max(lineH - rise, medianH))
      for (const w of words) {
        const xc = 0.5 * (w.box[0] + w.box[2])
        const yc = my + slope * (xc - mx)
        const y0 = Math.max(ly0, Math.min(ly1 - h, yc - 0.5 * h))
        w.box[1] = y0
        w.box[3] = y0 + h
      }
      return
    }
  }
  for (const w of words) {
    w.box[1] = ly0
    w.box[3] = ly1
  }
}

/** Guard against helpers whose char boxes don't cover the text: fall back to the line box */
function lineWordsFallback(words: LineWord[], line: PdfOcrLine): LineWord[] {
  const joined = words.map((w) => w.text).join(' ')
  // char boxes lost most of the text (some engines only box a prefix): keep the line whole
  if (joined.length < line.text.trim().length * 0.5) {
    const text = line.text.trim()
    return text ? [{ text, box: line.box, gap: false }] : []
  }
  return words
}

/** No-space scripts (cjk/kana/thai, NOT hangul — Korean spaces are real) via
    the shared pdf2docx classifier, so the viewer and the converter agree. */
const noSpaceEdge = (code: number | undefined): boolean =>
  code !== undefined && isNoSpaceScript(scriptOf(code))
const endsNoSpaceScript = (text: string): boolean => noSpaceEdge([...text].pop()?.codePointAt(0))
const startsNoSpaceScript = (text: string): boolean => noSpaceEdge(text.codePointAt(0))

/** A separator between two no-space-script neighbors is engine word
    segmentation, not a real space (Windows OcrLine.Text space-joins its CJK
    words) — writing it into the index would break search the same way
    unconditional joining did. */
const realSpace = (prev: LineWord, next: LineWord): boolean =>
  next.gap && !(endsNoSpaceScript(prev.text) && startsNoSpaceScript(next.text))

/** OCR lines (normalized, display orientation) → search-index entry + overlay words */
export function buildOcrPageData(lines: PdfOcrLine[], geom: PageGeom): OcrPageData | null {
  const disp = geomDispSize(geom)
  let text = ''
  const items: PageEntry['items'] = []
  const words: OcrWord[] = []
  for (const line of lines) {
    if (line.confidence < MIN_LINE_CONFIDENCE) continue
    const lw = lineWords(line)
    if (lw.length === 0) continue
    for (let i = 0; i < lw.length; i++) {
      const w = lw[i]!
      const rect = dispToPdfRect(geom, boxToDisp(w.box, disp))
      if (i > 0 && realSpace(lw[i - 1]!, w)) text += ' '
      const start = text.length
      text += w.text
      items.push({
        start,
        end: text.length,
        x: rect[0],
        y: rect[1],
        w: rect[2] - rect[0],
        h: rect[3] - rect[1],
      })
      const last = i === lw.length - 1
      words.push({
        text: w.text,
        rect,
        spaceAfter: last ? !endsNoSpaceScript(w.text) : realSpace(w, lw[i + 1]!),
      })
    }
    text += '\n'
  }
  if (items.length === 0) return null
  return { entry: { text, lower: foldCase(text), items }, words }
}

/** True when a page has effectively no extractable text (scanned candidate).
    Shared with the AI read_pages fallback so both sides agree on what "scanned" means. */
export const isScannedText = (text: string): boolean => text.replace(/\s/g, '').length < 8

export const isScannedEntry = (entry: PageEntry): boolean => isScannedText(entry.text)

/** Render the page bitmap for recognition (display orientation, ~2k px long edge) */
export async function renderPageForOcr(
  doc: PDFDocumentProxy,
  origIdx: number,
  geom: PageGeom,
): Promise<string | null> {
  const disp = geomDispSize(geom)
  const scale = Math.min(4, Math.max(1.5, 2048 / Math.max(disp.width, disp.height, 1)))
  try {
    const page = await doc.getPage(origIdx + 1)
    const viewport = page.getViewport({ scale, rotation: ((geom.rot % 360) + 360) % 360 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await page.render({ canvas, viewport }).promise
    const png = canvas.toDataURL('image/png').split(',')[1]
    return png && png.length > 0 ? png : null
  } catch {
    return null
  }
}

/** Recognition costs a bitmap render plus a platform engine call per page, so an
    unbounded pass over a fully scanned 500-page file ran for minutes in the
    background with no way out. This is the number of pages one pass recognizes;
    the rest is reported to the user instead of silently starting up. */
export const AUTO_OCR_PAGE_CAP = 40

/** `cap`: the page cap cut the pass short. `cancelled`: the user stopped it.
    `noEngine`: no OCR engine on this platform. `complete`: every scanned page ran. */
export type AutoOcrStop = 'complete' | 'cap' | 'cancelled' | 'noEngine'

export interface AutoOcrResult {
  stop: AutoOcrStop
  /** Pages recognized this pass */
  done: number
  /** Scanned pages in the document */
  total: number
  /** Scanned pages this pass never reached (0 unless `cap` or `cancelled`) */
  remaining: number
  /** The pages a following pass still has to walk, in the order this pass had
      queued them, so a capped pass is continued where it stopped instead of
      being restarted. Set only for `cap`; `null` once there is nothing left. */
  pending: number[] | null
}

/** Recognize the document's scanned pages sequentially, in the background.
    Reads the shared text index (so the document is not extracted a second time),
    visits pages from the current one and wraps around, and reports what it did.
    `signal` stops the pass: the renderer wires it to the user's Stop and to the
    teardown of the effect that started it. */
export async function runAutoOcr(opts: {
  doc: PDFDocumentProxy
  cache: SearchIndexCache
  /** Original page to start from, read when the index resolves (it takes a while).
      Ignored when `pending` continues an earlier pass. */
  fromPage: () => number
  /** The pages an earlier pass left, in its own visit order, as reported by
      `pending`. Handing them back is what makes a continuation pick up exactly
      the pages that pass never reached: the order is already settled, so it is
      followed rather than rebuilt, and a page is not paid for a second time. */
  pending?: readonly number[]
  signal: AbortSignal
  limit?: number
  geom: (origIdx: number) => PageGeom
  render: (doc: PDFDocumentProxy, origIdx: number, geom: PageGeom) => Promise<string | null>
  ocrPage: (png: string) => Promise<PdfOcrLine[] | null>
  onPage: (origIdx: number, data: OcrPageData) => void
  onProgress: (done: number, total: number) => void
}): Promise<AutoOcrResult> {
  const limit = opts.limit ?? AUTO_OCR_PAGE_CAP
  const index = await opts.cache.get(opts.doc)
  const scanned = index.map((entry, i) => (isScannedEntry(entry) ? i : -1)).filter((i) => i >= 0)
  // A continuation walks the queue it was handed as it stands. A first pass
  // builds one from the whole document, rotating so the pages after the reading
  // position come first; pages that rotation had already walked before the cap
  // are never re-queued, which is what keeps the wrapped tail from being paid
  // for twice.
  let queue: readonly number[] = opts.pending ?? scanned
  if (!opts.pending) {
    const from = scanned.findIndex((i) => i >= opts.fromPage())
    if (from > 0) queue = [...scanned.slice(from), ...scanned.slice(0, from)]
  }
  const total = scanned.length
  // The cap counts attempted pages, not successes: a page that fails to render or
  // throws in the engine still cost work, and must not let the pass run forever
  const finish = (
    stop: AutoOcrStop,
    done: number,
    attempted: number,
    pending: number[] | null,
  ): AutoOcrResult => ({
    stop,
    done,
    total,
    remaining: queue.length - attempted,
    pending,
  })
  let done = 0
  let attempted = 0
  for (let at = 0; at < queue.length; at += 1) {
    if (attempted >= limit) return finish('cap', done, attempted, queue.slice(at))
    if (opts.signal.aborted) return finish('cancelled', done, attempted, null)
    opts.onProgress(done, total)
    // one geometry snapshot for render and box conversion: a rotation between
    // the two awaits must not remap boxes through different axes
    const geom = opts.geom(queue[at]!)
    const png = await opts.render(opts.doc, queue[at]!, geom)
    // a cancel after the render must not pay for the engine call
    if (opts.signal.aborted) return finish('cancelled', done, attempted, null)
    if (!png) {
      attempted += 1
      continue // no bitmap; the next page may still render
    }
    let lines: PdfOcrLine[] | null
    try {
      lines = await opts.ocrPage(png)
    } catch {
      attempted += 1
      continue // this page failed; the rest may still recognize
    }
    if (lines === null) return finish('noEngine', done, attempted, null)
    // an engine call already in flight is kept: the work is paid for
    const data = buildOcrPageData(lines, geom)
    if (data) {
      opts.onPage(queue[at]!, data)
      done += 1
    }
    attempted += 1
  }
  return finish('complete', done, attempted, null)
}

/** Transparent selectable overlay; spans are re-projected through the live geometry,
    so zoom and unsaved rotations need no re-recognition */
export function OcrTextLayer({
  data,
  geom,
  scale,
}: {
  data: OcrPageData
  geom: PageGeom
  scale: number
}): ReactElement {
  return (
    <div className="pdf-ocr-layer">
      {data.words.map((w, i) => {
        const box = pdfRectToCss(geom, w.rect, scale)
        const fontPx = Math.max(box.height, 1)
        const measured = measurePt(w.text, fontPx, 'sans-serif')
        return (
          <span
            key={i}
            style={{
              left: box.left,
              top: box.top,
              fontSize: fontPx,
              transform: `scaleX(${measured > 0 ? box.width / measured : 1})`,
            }}
          >
            {w.text}
            {w.spaceAfter ? ' ' : ''}
          </span>
        )
      })}
    </div>
  )
}
